import { db } from '@/lib/db';
import { createOrUpdateLead, sendEmailToLead, LeadSquaredError } from '@/lib/leadsquared';
import { resolveRecipient, sendModeLabel } from '@/lib/sendGuard';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { resolveStepDate } from '@/lib/stepSchedule';
import { isWithinSendWindow } from '@/lib/sendWindow';
import { validateRenderedMessage, validateRenderedMessageForChannel } from '@/lib/messageValidation';
import { normalizeChannel } from '@/lib/channels';
import { deliverChannelMessage, sandboxTargetPhone, type DeliveryChannel } from '@/lib/channelDelivery';

// Steps that get queued automatically when the cadence launches. Each one's
// send time comes from its own editable offset (see lib/stepSchedule.ts), so
// changing a date on the Schedule tab changes real behaviour.
//
// Deliberately excluded: `confirm` fires on a registration event we have no
// webhook for, and `attend`/`noshow` are triggered by the Zoom attendance
// import instead (see lib/attendance.ts). `linkedin` is human-or-bot, tracked
// through its own queue. `whatsapp` joins `confirm` on the event side — it's
// queued per-registration by lib/linkedin/ingest.ts, not at launch.
export const AUTOMATED_STEP_KEYS = ['invite', 'nudge', 'final', 't3', 't1d', 't1h', 'sms'] as const;

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

  const skips = [
    withoutEmail ? `${withoutEmail} with no email on file` : null,
    unverified ? `${unverified} with an unverified inferred email` : null,
    unschedulable ? `${unschedulable} step(s) with no resolvable date — set the webinar date on Setup` : null,
  ].filter(Boolean);

  // SQLite's createMany doesn't support skipDuplicates, so the app-level filter
  // below (not the DB) is what avoids re-queuing a duplicate row on a repeat,
  // non-racing launch — the @@unique([campaignId, contactId, stepKey]) constraint
  // on CadenceSend is the backstop for the genuine race (two launches at once),
  // not the primary mechanism. All writes are one transaction: a crash partway
  // through used to be able to leave sends queued while the campaign still read
  // as not_started.
  const { queued } = await db.$transaction(async (tx) => {
    const existing = await tx.cadenceSend.findMany({ where: { campaignId, stepKey: { in: [...AUTOMATED_STEP_KEYS] } }, select: { contactId: true, stepKey: true } });
    const existingKey = new Set(existing.map((e) => `${e.contactId}:${e.stepKey}`));
    const toCreate = rows.filter((r) => !existingKey.has(`${r.contactId}:${r.stepKey}`));

    if (toCreate.length > 0) await tx.cadenceSend.createMany({ data: toCreate });
    await tx.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'running', status: 'live' } });
    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `Launched cadence for ${sendable.length} approved contacts across ${scheduled.length} scheduled steps (SEND_MODE=${sendModeLabel()})${skips.length ? ` — skipped ${skips.join('; ')}` : ''}`,
        dot: 'var(--success-500)',
      },
    });

    return { queued: toCreate.length };
  });

  return { queued, skippedNoEmail: withoutEmail, skippedUnverified: unverified };
}

/**
 * Undoes a stopped cadence back to "never launched" so Schedule can offer
 * Launch again. Stopping was already documented as a deliberate, irreversible
 * decision — this doesn't reverse *that* decision, it starts an entirely new
 * cadence run from scratch. Every send left over from the stopped run is
 * marked `skipped` (not deleted — they stay in the log as a record of what was
 * abandoned) so a fresh `launchCadence` call queues a clean new set of sends
 * without the @@unique([campaignId, contactId, stepKey]) constraint blocking
 * them as duplicates of the old, abandoned ones.
 */
export async function restartCadence(campaignId: string): Promise<{ skipped: number }> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.cadenceStatus !== 'stopped') {
    throw new Error('Only a stopped cadence can be restarted.');
  }

  const { skipped } = await db.$transaction(async (tx) => {
    const result = await tx.cadenceSend.updateMany({
      where: { campaignId, status: 'queued' },
      data: { status: 'skipped', error: 'Abandoned — cadence was stopped and later restarted' },
    });
    await tx.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'not_started' } });
    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `Cadence reset for a fresh launch — ${result.count} send(s) left over from the stopped run marked skipped`,
        dot: 'var(--warning-700)',
      },
    });
    return { skipped: result.count };
  });

  return { skipped };
}

interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  // How many due sends were left unprocessed after this call — either because
  // campaign.dailyLimit was hit, the send window is currently closed, or
  // (shouldn't normally happen, since this loops to exhaustion otherwise) the
  // batch cap below was reached. Non-zero means there's more work waiting for
  // the next tick.
  remaining: number;
  dailyLimitReached: boolean;
  outsideSendWindow: boolean;
}

// Bounds how many sends a single call processes, independent of dailyLimit —
// protects one cadence-tick invocation (or one click of "Run due sends now")
// from running unbounded if a huge backlog piles up. Anything left over is
// picked up by the next tick; nothing is silently dropped.
const MAX_PER_CALL = 2000;
const BATCH_SIZE = 100;

export async function processDueSends(campaignId: string): Promise<ProcessResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.cadenceStatus !== 'running') return { processed: 0, sent: 0, failed: 0, remaining: 0, dailyLimitReached: false, outsideSendWindow: false };

  const now = campaign.simulatedNow ?? new Date();

  // Quiet-hours guard: `scheduleWindow` used to be a free-text label nothing
  // read. Now a send whose dueAt has arrived still waits for the next tick
  // inside the configured window — it stays `queued`, nothing is marked failed.
  if (!isWithinSendWindow(now, campaign.scheduleWindow)) {
    const remaining = await db.cadenceSend.count({ where: { campaignId, status: 'queued', dueAt: { lte: now } } });
    return { processed: 0, sent: 0, failed: 0, remaining, dailyLimitReached: false, outsideSendWindow: remaining > 0 };
  }

  // dailyLimit counts against the simulated/real "now", not wall-clock UTC —
  // consistent with every other time-based decision in this file.
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const sentToday = await db.cadenceSend.count({ where: { campaignId, status: 'sent', sentAt: { gte: startOfDay, lt: endOfDay } } });
  let remainingBudget = Math.max(0, campaign.dailyLimit - sentToday);

  let sent = 0;
  let failed = 0;
  let processed = 0;
  let dailyLimitReached = remainingBudget === 0;

  while (processed < MAX_PER_CALL && remainingBudget > 0) {
    const due = await db.cadenceSend.findMany({
      where: { campaignId, status: 'queued', dueAt: { lte: now } },
      include: { contact: true },
      take: Math.min(BATCH_SIZE, remainingBudget, MAX_PER_CALL - processed),
    });
    if (due.length === 0) break;

    for (const send of due) {
      const result = await processSingleSend(campaignId, campaign, send);
      // Sends that fail outright (missing template/email, or a thrown error)
      // don't count against the daily budget — the budget limits real outbound
      // mail, not bookkeeping failures.
      if (result === 'sent') {
        sent++;
        remainingBudget--;
      } else if (result === 'skipped') {
        // A compliance skip (missing phone, no opt-in…) is neither a failure
        // nor budget spend — it's bookkeeping, visible via the row's error.
      } else {
        failed++;
      }
      processed++;
    }
  }

  if (remainingBudget === 0) dailyLimitReached = true;

  const remaining = await db.cadenceSend.count({ where: { campaignId, status: 'queued', dueAt: { lte: now } } });
  return { processed, sent, failed, remaining, dailyLimitReached, outsideSendWindow: false };
}

type DueSendWithContact = Awaited<ReturnType<typeof db.cadenceSend.findMany<{ include: { contact: true } }>>>[number];

async function processSingleSend(
  campaignId: string,
  campaign: Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>,
  send: DueSendWithContact
): Promise<'sent' | 'failed' | 'skipped'> {
    const template = await db.template.findUnique({ where: { campaignId_key: { campaignId, key: send.stepKey } } });
    const contact = send.contact;

    // Hidden templates drop out of the flow entirely — before any channel
    // routing — so hiding a step on the Templates tab stops every send of it.
    if (template?.hidden) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', error: 'Template is hidden on the Templates tab' } });
      return 'skipped';
    }

    // Channel router — SMS/WhatsApp steps branch off before the email-specific
    // requirements (they need a phone + consent flags instead of an inbox, and
    // their own validators/transports).
    if (template) {
      const channel = normalizeChannel(template.channel);
      if (channel === 'sms' || channel === 'whatsapp') {
        return processChannelSend(campaignId, campaign, send, contact, template, channel);
      }
    }

    if (!template || !contact.email) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', error: 'Missing template or contact email' } });
      return 'failed';
    }

    // A personalized message for this contact+step wins over the shared template
    // — but only if it actually passes content validation. Previously "exists"
    // was the only bar: a personalized draft with a leftover {{token}} or a
    // dropped registration link would still be used as-is over the safe,
    // known-good template. Now an invalid personalized message is treated the
    // same as "none exists" — the campaign's plain template goes out instead,
    // and the reason is recorded so it's visible on Control Center.
    const personalizedRaw = await db.personalizedMessage.findUnique({
      where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: send.stepKey } },
    });
    const link = campaign.registrationLink ?? '';
    const personalizedValidation = personalizedRaw ? validateRenderedMessage(personalizedRaw.subject, personalizedRaw.body, send.stepKey !== 'linkedin', link) : null;
    const personalized = personalizedValidation?.valid ? personalizedRaw : null;
    if (personalizedRaw && !personalizedValidation?.valid) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `Personalized copy for ${contact.name} skipped — sent the template instead`,
        detail: (personalizedValidation?.issues ?? []).map((i) => i.message).join('; ').slice(0, 300),
        actionsCsv: 'view',
      });
    }

    const mergeOpts = { firstName: contact.name.split(' ')[0] || contact.name, company: contact.account, topic: campaign.name, link };
    // Personalized copy is rendered too: the model is told not to leave merge
    // tokens behind, but rendering anyway means a stray one resolves instead of
    // shipping raw to a real inbox.
    const subject = renderMergeFields(personalized?.subject ?? template.subject ?? campaign.name, mergeOpts);
    const body = renderMergeFields(personalized ? personalized.body : template.body, mergeOpts);

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
          text: `Sent "${template.label}" to ${contact.name}${personalized ? ' (personalized)' : ''}${sandboxed ? ' (sandboxed → allowlisted test lead)' : ''}`,
          dot: 'var(--success-500)',
        },
      });
      return 'sent';
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
      return 'failed';
    }
}

/**
 * SMS / WhatsApp delivery path. Compliance gates run in order and SKIP (never
 * fail) when a contact simply isn't eligible — missing mobile, opted out of
 * SMS, no WhatsApp opt-in. Delivery goes through deliverChannelMessage, which
 * picks the configured strategy (direct LSQ endpoint vs Automation trigger).
 */
async function processChannelSend(
  campaignId: string,
  campaign: Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>,
  send: DueSendWithContact,
  contact: DueSendWithContact['contact'],
  template: { label: string; channel: string; body: string; subject: string | null },
  channel: DeliveryChannel
): Promise<'sent' | 'failed' | 'skipped'> {
  const skip = async (reason: string): Promise<'skipped'> => {
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', error: reason } });
    return 'skipped';
  };

  if (!contact.phone) return skip('No mobile number on file for this contact');
  if (channel === 'sms' && contact.smsOptOut) return skip('Contact has opted out of SMS');
  if (channel === 'whatsapp' && !contact.whatsappOptIn) return skip('No WhatsApp opt-in on record — Meta template messages require it');

  // Render from personalized copy when one exists and validates, else template.
  const link = campaign.registrationLink ?? '';
  const personalizedRaw = await db.personalizedMessage.findUnique({
    where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: send.stepKey } },
  });
  const mergeOpts = { firstName: contact.name.split(' ')[0] || contact.name, company: contact.account, topic: campaign.name, link };
  const body = renderMergeFields(personalizedRaw ? personalizedRaw.body : template.body, mergeOpts);

  const validation = validateRenderedMessageForChannel(null, body, false, link, channel);
  if (!validation.valid) {
    const detail = validation.issues.map((i) => i.message).join('; ').slice(0, 280);
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', error: `Content rejected: ${detail}` } });
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'warning',
      title: `${channel.toUpperCase()} draft for ${contact.name} failed validation`,
      detail,
      actionsCsv: 'view',
    });
    return 'failed';
  }

  try {
    // The recipient: live → the contact's own number; sandbox → the allowlist
    // lead's number, mirroring how email sends are redirected in sandbox mode.
    const targetPhone = (process.env.SEND_MODE === 'live' ? contact.phone : await sandboxTargetPhone()).replace(/[^\d+]/g, '');

    // The lead must exist in LeadSquared first (trigger strategy attaches the
    // activity to it; direct strategy keeps CRM state consistent too).
    let lsqLeadId = contact.lsqLeadId;
    if (!lsqLeadId && contact.email) {
      const result = await createOrUpdateLead([
        { Attribute: 'EmailAddress', Value: contact.email },
        { Attribute: 'FirstName', Value: contact.name.split(' ')[0] || contact.name },
        { Attribute: 'Phone', Value: contact.phone },
        { Attribute: 'Company', Value: contact.account },
      ]);
      lsqLeadId = result.Message.Id;
      await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId } });
    }
    if (!lsqLeadId) return skip('No email to key a LeadSquared lead on and none synced yet');

    const delivery = await deliverChannelMessage({
      channel,
      stepKey: send.stepKey,
      campaignName: campaign.name,
      message: body,
      phone: targetPhone,
      lsqLeadId,
    });

    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), error: null } });
    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Sent ${channel.toUpperCase()} "${template.label}" to ${contact.name} (${delivery.strategyUsed}: ${delivery.detail})${process.env.SEND_MODE !== 'live' ? ' — sandboxed → allowlisted phone' : ''}`,
        dot: 'var(--success-500)',
      },
    });
    return 'sent';
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 280);
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', error: message } });
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: `${channel.toUpperCase()} send failed for ${contact.name}`,
      detail: message,
      actionsCsv: 'retry',
    });
    return 'failed';
  }
}

export async function advanceSimulatedClock(campaignId: string, days: number) {
  const now = await effectiveNow(campaignId);
  const next = addDays(now, days);
  await db.campaign.update({ where: { id: campaignId }, data: { simulatedNow: next } });
  return next;
}
