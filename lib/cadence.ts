import { db } from '@/lib/db';
import { createOrUpdateLead, sendEmailToLead, LeadSquaredError } from '@/lib/leadsquared';
import { resolveRecipient, sendModeLabel } from '@/lib/sendGuard';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { resolveStepDate } from '@/lib/stepSchedule';

// Steps that get queued automatically when the cadence launches. Each one's
// send time comes from its own editable offset (see lib/stepSchedule.ts), so
// changing a date on the Schedule tab changes real behaviour.
//
// Deliberately excluded: `confirm` fires on a registration event we have no
// webhook for, and `attend`/`noshow` are triggered by the Zoom attendance
// import instead (see lib/attendance.ts). `linkedin` is human-or-bot, tracked
// through its own queue.
export const AUTOMATED_STEP_KEYS = ['invite', 'nudge', 'final', 't3', 't1d', 't1h'] as const;

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export async function effectiveNow(campaignId: string): Promise<Date> {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { simulatedNow: true } });
  return c.simulatedNow ?? new Date();
}

export function renderMergeFields(str: string, opts: { firstName: string; company: string; topic: string; link: string }): string {
  return str
    .replace(/\{\{\s*firstName\s*\}\}/g, opts.firstName)
    .replace(/\{\{\s*lastName\s*\}\}/g, '')
    .replace(/\{\{\s*company\s*\}\}/g, opts.company)
    .replace(/\{\{\s*topic\s*\}\}/g, opts.topic)
    .replace(/\{\{\s*link\s*\}\}/g, opts.link);
}

export async function launchCadence(campaignId: string) {
  const [campaign, steps, approvedContacts] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    db.cadenceStep.findMany({ where: { campaignId, key: { in: [...AUTOMATED_STEP_KEYS] }, enabled: true } }),
    db.contact.findMany({ where: { campaignId, approved: true } }),
  ]);

  const now = campaign.simulatedNow ?? new Date();

  // Each step's send time comes from its own offset, resolved against the launch
  // moment or the webinar date. A webinar-anchored step with no date set can't be
  // scheduled, so it's skipped rather than silently queued for "now".
  const scheduled = steps
    .map((step) => ({ step, dueAt: resolveStepDate(step, { launchAt: now, webinarAt: campaign.scheduledAt }) }))
    .filter((s): s is { step: (typeof steps)[number]; dueAt: Date } => s.dueAt !== null);
  const unschedulable = steps.length - scheduled.length;

  // Skip rather than queue-and-fail: no email at all, or an enrichment-inferred
  // address a human hasn't verified yet (the send path would refuse it anyway).
  const sendable = approvedContacts.filter((c) => c.email && !(c.emailSimulated && !c.emailVerified));
  const withoutEmail = approvedContacts.filter((c) => !c.email).length;
  const unverified = approvedContacts.filter((c) => c.email && c.emailSimulated && !c.emailVerified).length;

  const rows = scheduled.flatMap(({ step, dueAt }) =>
    sendable.map((contact) => ({
      campaignId,
      contactId: contact.id,
      stepKey: step.key,
      dueAt,
      status: 'queued',
    }))
  );

  // Avoid duplicate queued/sent rows for the same contact+step if launched twice.
  const existing = await db.cadenceSend.findMany({ where: { campaignId, stepKey: { in: [...AUTOMATED_STEP_KEYS] } }, select: { contactId: true, stepKey: true } });
  const existingKey = new Set(existing.map((e) => `${e.contactId}:${e.stepKey}`));
  const toCreate = rows.filter((r) => !existingKey.has(`${r.contactId}:${r.stepKey}`));

  if (toCreate.length > 0) await db.cadenceSend.createMany({ data: toCreate });

  await db.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'running', status: 'live' } });

  const skips = [
    withoutEmail ? `${withoutEmail} with no email on file` : null,
    unverified ? `${unverified} with an unverified inferred email` : null,
    unschedulable ? `${unschedulable} step(s) with no resolvable date — set the webinar date on Setup` : null,
  ].filter(Boolean);

  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: `Launched cadence for ${sendable.length} approved contacts across ${scheduled.length} scheduled steps (SEND_MODE=${sendModeLabel()})${skips.length ? ` — skipped ${skips.join('; ')}` : ''}`,
      dot: 'var(--success-500)',
    },
  });

  return { queued: toCreate.length, skippedNoEmail: withoutEmail, skippedUnverified: unverified };
}

interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
}

export async function processDueSends(campaignId: string): Promise<ProcessResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.cadenceStatus !== 'running') return { processed: 0, sent: 0, failed: 0 };

  const now = campaign.simulatedNow ?? new Date();
  const due = await db.cadenceSend.findMany({
    where: { campaignId, status: 'queued', dueAt: { lte: now } },
    include: { contact: true },
    take: 100,
  });

  let sent = 0;
  let failed = 0;

  for (const send of due) {
    const template = await db.template.findUnique({ where: { campaignId_key: { campaignId, key: send.stepKey } } });
    const contact = send.contact;
    if (!template || !contact.email) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', error: 'Missing template or contact email' } });
      failed++;
      continue;
    }

    const mergeOpts = { firstName: contact.name.split(' ')[0] || contact.name, company: contact.account, topic: campaign.name, link: campaign.registrationLink ?? '' };
    const subject = template.subject ? renderMergeFields(template.subject, mergeOpts) : campaign.name;
    const body = renderMergeFields(template.body, mergeOpts);

    try {
      // Resolve the recipient first: this throws for an inferred-but-unverified
      // address, and we must not write a guessed email into the CRM either.
      const { email: recipientEmail, sandboxed } = resolveRecipient(contact);

      // Ensure the contact exists as a LeadSquared lead before emailing it.
      if (!contact.lsqLeadId) {
        const result = await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: contact.email },
          { Attribute: 'FirstName', Value: mergeOpts.firstName },
          { Attribute: 'Company', Value: contact.account },
        ]);
        await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId: result.Message.Id } });
      }

      await sendEmailToLead({
        recipientEmail,
        subject,
        contentHtml: body.replace(/\n/g, '<br/>'),
        contentText: body,
      });

      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date() } });
      await db.activityLogEntry.create({
        data: {
          campaignId,
          text: `Sent "${template.label}" to ${contact.name}${sandboxed ? ' (sandboxed → allowlisted test lead)' : ''}`,
          dot: 'var(--success-500)',
        },
      });
      sent++;
    } catch (err) {
      const message = err instanceof LeadSquaredError ? err.message : String(err);
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', error: message } });
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: `Send failed for ${contact.name}`,
        detail: message.slice(0, 300),
        actionsCsv: 'retry',
      });
      failed++;
    }
  }

  return { processed: due.length, sent, failed };
}

export async function advanceSimulatedClock(campaignId: string, days: number) {
  const now = await effectiveNow(campaignId);
  const next = addDays(now, days);
  await db.campaign.update({ where: { id: campaignId }, data: { simulatedNow: next } });
  return next;
}
