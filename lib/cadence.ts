import { db } from '@/lib/db';
import { createOrUpdateLead, sendEmailToLead, LeadSquaredError } from '@/lib/leadsquared';
import { resolveRecipient, getSendMode } from '@/lib/sendGuard';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { resolveStepDate } from '@/lib/stepSchedule';
import { isWithinSendWindow } from '@/lib/sendWindow';
import { validateRenderedMessage, validateRenderedMessageForChannel } from '@/lib/messageValidation';
import { normalizeChannel, isAutomatableChannel } from '@/lib/channels';
import { deliverChannelMessage, sandboxTargetPhone, postSentActivityIfMapped, type DeliveryChannel } from '@/lib/channelDelivery';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { registrationUrl } from '@/lib/registration';
import { appOrigin } from '@/lib/appOrigin';

export { isAutomatableChannel } from '@/lib/channels';

export { isLaunchQueued, isPreWebinarReminder } from '@/lib/stepTrigger';
import { isPreWebinarReminder } from '@/lib/stepTrigger';

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export async function effectiveNow(campaignId: string): Promise<Date> {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { simulatedNow: true } });
  return c.simulatedNow ?? new Date();
}

/**
 * The link a message should carry for one contact.
 *
 * An unregistered contact on a one-click campaign gets a signed link that
 * registers them the moment they click it — that is the entire point of
 * one-click sign-up. A contact who has already registered gets the plain
 * event link instead: sending an already-registered person another "register
 * here" link is redundant, and reminders/confirmations should read as being
 * about the event, not as a second invitation.
 *
 * This is a per-contact decision, not a per-step one, because the same rule
 * is correct whether the send is the first invite or the T-1 hour reminder —
 * what matters is whether THIS contact has registered yet, not which step is
 * firing.
 */
function effectiveLink(
  campaign: { id: string; oneClickSignup: boolean; registrationLink: string | null; zoomLink: string | null },
  contact: { id: string; registeredAt: Date | null }
): string {
  if (campaign.oneClickSignup && !contact.registeredAt) {
    return registrationUrl(appOrigin(), campaign.id, contact.id);
  }
  return campaign.registrationLink || campaign.zoomLink || '';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m] || m));
}

import { renderMergeFields } from './mergeFields';
export { renderMergeFields };

export async function launchCadence(campaignId: string) {
  const [campaign, allLaunchSteps, approvedContacts] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    db.cadenceStep.findMany({ where: { campaignId, trigger: 'launch', enabled: true, removedAt: null } }),
    db.contact.findMany({ where: { campaignId, approved: true } }),
  ]);

  const now = campaign.simulatedNow ?? new Date();

  // `isAutomatableChannel` parses a display string, which SQL cannot do, so the
  // channel half of the rule is applied here rather than in the query above.
  const steps = allLaunchSteps.filter((step) => isAutomatableChannel(step.channel));

  // Each step's send time comes from its own offset, resolved against the launch
  // moment or the webinar date. A webinar-anchored step with no date set can't be
  // scheduled, so it's skipped rather than silently queued for "now".
  const scheduled = steps
    .map((step) => ({ step, dueAt: resolveStepDate(step, { launchAt: now, webinarAt: campaign.scheduledAt }) }))
    .filter((s): s is { step: (typeof steps)[number]; dueAt: Date } => s.dueAt !== null);
  const unschedulable = steps.length - scheduled.length;

  // Eligibility is per CHANNEL, not global. Requiring an email for every step
  // meant an SMS step could never reach a contact who has a mobile but no
  // usable inbox — which is exactly who an SMS invite exists for.
  const emailable = (c: (typeof approvedContacts)[number]) => !!c.email && !(c.emailSimulated && !c.emailVerified);
  const textable = (c: (typeof approvedContacts)[number]) => !!c.phone;
  // WhatsApp additionally needs explicit opt-in: Meta requires it, and the
  // send path refuses without it, so queueing would only manufacture failures.
  const whatsappable = (c: (typeof approvedContacts)[number]) => !!c.phone && c.whatsappOptIn;

  const eligibleFor = (channel: string) => {
    const ch = channel.toLowerCase();
    if (ch === 'sms') return approvedContacts.filter(textable);
    if (ch === 'whatsapp') return approvedContacts.filter(whatsappable);
    return approvedContacts.filter(emailable);
  };

  const rows = scheduled.flatMap(({ step, dueAt }) =>
    eligibleFor(step.channel).map((contact) => ({
      campaignId,
      contactId: contact.id,
      stepKey: step.key,
      dueAt,
      status: 'queued',
    }))
  );

  const usesSms = scheduled.some((s) => s.step.channel.toLowerCase() === 'sms');
  const usesWhatsapp = scheduled.some((s) => s.step.channel.toLowerCase() === 'whatsapp');
  const withoutEmail = approvedContacts.filter((c) => !c.email).length;
  const unverified = approvedContacts.filter((c) => c.email && c.emailSimulated && !c.emailVerified).length;
  const withoutPhone = approvedContacts.filter((c) => !c.phone).length;
  const withoutOptIn = approvedContacts.filter((c) => c.phone && !c.whatsappOptIn).length;

  const skips = [
    withoutEmail ? `${withoutEmail} with no email on file (email steps)` : null,
    unverified ? `${unverified} with an unverified inferred email` : null,
    usesSms && withoutPhone ? `${withoutPhone} with no mobile number (SMS steps)` : null,
    usesWhatsapp && withoutOptIn ? `${withoutOptIn} without WhatsApp opt-in` : null,
    unschedulable ? `${unschedulable} step(s) with no resolvable date — set the webinar date on Setup` : null,
  ].filter(Boolean);

  // The app-level filter below (not skipDuplicates on createMany) is what
  // avoids re-queuing a duplicate row on a repeat, non-racing launch — it
  // knows exactly how many rows it's about to insert, which the returned
  // `queued` count below depends on. The @@unique([campaignId, contactId,
  // stepKey]) constraint on CadenceSend is the backstop for the genuine race
  // (two launches at once), not the primary mechanism. All writes are one
  // transaction: a crash partway through used to be able to leave sends
  // queued while the campaign still read as not_started.
  // Resolved once, before the transaction, and reused in the log line below —
  // sendModeLabel() only reads the env var, so it can report "sandbox" here
  // even when the DB-backed send mode (what actually governs the sends this
  // launch queues) has been switched to live on Integrations.
  const activeSendMode = await getSendMode();

  const { queued } = await db.$transaction(async (tx) => {
    // If this campaign was stopped and restarted, purge leftover 'skipped' sends
    // for these steps so fresh sends can be queued without unique constraint or duplicate exclusion conflicts.
    await tx.cadenceSend.deleteMany({
      where: {
        campaignId,
        status: 'skipped',
        stepKey: { in: scheduled.map((s) => s.step.key) },
      },
    });

    // Scoped to the steps actually being queued now. The previous fixed key
    // list would have missed a user-added step and re-queued it on every
    // launch, relying on the unique constraint to throw.
    const existing = await tx.cadenceSend.findMany({
      where: { campaignId, stepKey: { in: scheduled.map((s) => s.step.key) } },
      select: { contactId: true, stepKey: true },
    });
    const existingKey = new Set(existing.map((e) => `${e.contactId}:${e.stepKey}`));
    const toCreate = rows.filter((r) => !existingKey.has(`${r.contactId}:${r.stepKey}`));

    if (toCreate.length > 0) await tx.cadenceSend.createMany({ data: toCreate });
    await tx.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'running', status: 'live' } });
    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `Launched cadence: ${toCreate.length} send(s) queued across ${scheduled.length} step(s) for ${approvedContacts.length} approved contact(s) (SEND_MODE=${activeSendMode})${skips.length ? ` — skipped ${skips.join('; ')}` : ''}`,
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

  // Quiet-hours guard: evaluated against IST (Asia/Kolkata)
  if (!isWithinSendWindow(now, campaign.scheduleWindow, 'Asia/Kolkata')) {
    const remaining = await db.cadenceSend.count({ where: { campaignId, status: { in: ['queued', 'processing'] }, dueAt: { lte: now } } });
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

  // Stale claim recovery: reset rows stuck in 'processing' for >5 minutes (e.g. from crashed workers or aborted ticks).
  // Evaluates claimedAt (not dueAt) to prevent double-sending active backlog items.
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  await db.cadenceSend.updateMany({
    where: { campaignId, status: 'processing', claimedAt: { not: null, lte: staleThreshold } },
    data: { status: 'queued', claimedAt: null },
  });

  while (processed < MAX_PER_CALL && remainingBudget > 0) {
    // Atomically claim a batch of queued sends to prevent race conditions across concurrent ticks
    const candidateIds = await db.$transaction(async (tx) => {
      const candidates = await tx.cadenceSend.findMany({
        where: { campaignId, status: 'queued', dueAt: { lte: now } },
        select: { id: true },
        take: Math.min(BATCH_SIZE, remainingBudget, MAX_PER_CALL - processed),
      });
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      await tx.cadenceSend.updateMany({
        where: { id: { in: ids }, status: 'queued' },
        data: { status: 'processing', claimedAt: now },
      });
      return ids;
    });

    if (candidateIds.length === 0) break;

    const due = await db.cadenceSend.findMany({
      where: { id: { in: candidateIds } },
      include: { contact: true },
    });

    for (const send of due) {
      try {
        const result = await processSingleSend(campaignId, campaign, send);
        // Sends that fail outright (missing template/email, or a thrown error)
        // don't count against the daily budget — the budget limits real outbound
        // mail, not bookkeeping failures.
        if (result === 'sent') {
          sent++;
          remainingBudget--;
        } else if (result === 'skipped') {
          // A compliance skip (missing phone, no opt-in, unregistered…) is neither a failure
          // nor budget spend — it's bookkeeping, visible via the row's error.
        } else {
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.cadenceSend.update({
          where: { id: send.id },
          data: { status: 'failed', error: msg },
        }).catch(() => {});
        failed++;
      }
      processed++;
    }
  }

  if (remainingBudget === 0) dailyLimitReached = true;

  const remaining = await db.cadenceSend.count({ where: { campaignId, status: { in: ['queued', 'processing'] }, dueAt: { lte: now } } });
  return { processed, sent, failed, remaining, dailyLimitReached, outsideSendWindow: false };
}

type DueSendWithContact = Awaited<ReturnType<typeof db.cadenceSend.findMany<{ include: { contact: true } }>>>[number];

async function processSingleSend(
  campaignId: string,
  campaign: Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>,
  send: DueSendWithContact
): Promise<'sent' | 'failed' | 'skipped'> {
    // Resolves through the step's own template, then this campaign's override,
    // then the shared library, then the legacy per-campaign row. See
    // lib/messageTemplates.ts for why all four still exist.
    const template = await resolveStepTemplate(campaignId, send.stepKey);
    const contact = send.contact;

    // Step enablement guard: if the step was disabled or removed in the planner, skip sending
    const step = await db.cadenceStep.findUnique({
      where: { campaignId_key: { campaignId, key: send.stepKey } },
      select: { enabled: true, removedAt: true },
    });
    if (step && (!step.enabled || step.removedAt)) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: { status: 'skipped', claimedAt: null, error: 'Step is disabled or removed' },
      });
      return 'skipped';
    }

    // Hidden templates drop out of the flow entirely — before any channel
    // routing — so hiding a message stops every send of it.
    if (template?.hidden) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', claimedAt: null, error: 'Template is hidden' } });
      return 'skipped';
    }

    // Pre-webinar reminder guard: Unregistered prospects must not receive countdown alerts
    if (isPreWebinarReminder(send.stepKey) && !contact.registeredAt) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: { status: 'skipped', claimedAt: null, error: 'Contact has not registered — pre-webinar reminder skipped' },
      });
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
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: 'Missing template or contact email' } });
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
    const link = effectiveLink(campaign, contact);
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

    const mergeOpts = {
      firstName: contact.name.split(' ')[0] || contact.name,
      company: contact.account,
      topic: campaign.name,
      link,
      date: campaign.date,
      speaker: campaign.speakerName ?? '',
    };
    // Personalized copy is rendered too: the model is told not to leave merge
    // tokens behind, but rendering anyway means a stray one resolves instead of
    // shipping raw to a real inbox.
    const subject = renderMergeFields(personalized?.subject ?? template.subject ?? campaign.name, mergeOpts);
    const body = renderMergeFields(personalized ? personalized.body : template.body, mergeOpts);

    try {
      // Resolve the recipient first: this throws for an inferred-but-unverified
      // address, and we must not write a guessed email into the CRM either.
      const activeSendMode = await getSendMode();
      const { email: recipientEmail, sandboxed } = resolveRecipient(contact, activeSendMode);

      // Ensure the contact exists as a LeadSquared lead before emailing it.
      let lsqLeadId = contact.lsqLeadId;
      if (!lsqLeadId) {
        const result = await createOrUpdateLead([
          { Attribute: 'EmailAddress', Value: contact.email },
          { Attribute: 'FirstName', Value: mergeOpts.firstName },
          { Attribute: 'Company', Value: contact.account },
        ]);
        lsqLeadId = result.Message.Id;
        await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId } });
      }

      await sendEmailToLead({
        recipientEmail,
        subject,
        contentHtml: escapeHtml(body).replace(/\n/g, '<br/>'),
        contentText: body,
      });

      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, error: null } });
      // This send working retracts the card its own failure raises below.
      await resolveAttentionItems(campaignId, [`Send failed for ${contact.name}`]);

      // Optional hook for THEIR automations: post the mapped "email sent"
      // activity if the operator mapped one for this channel (Integrations).
      try {
        await postSentActivityIfMapped({
          channel: 'email',
          lsqLeadId,
          campaignName: campaign.name,
          stepKey: send.stepKey,
          note: `Email "${template.label}" delivered`,
        });
      } catch {
        /* mapping hook must never fail the email itself */
      }

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
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: message } });
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
  template: { label: string; channel: string; body: string; subject: string | null; dltTemplateId?: string | null; senderId?: string | null },
  channel: DeliveryChannel
): Promise<'sent' | 'failed' | 'skipped'> {
  const skip = async (reason: string): Promise<'skipped'> => {
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', claimedAt: null, error: reason } });
    return 'skipped';
  };

  if (!contact.phone) return skip('No mobile number on file for this contact');
  if (channel === 'sms' && contact.smsOptOut) return skip('Contact has opted out of SMS');
  if (channel === 'whatsapp' && !contact.whatsappOptIn) return skip('No WhatsApp opt-in on record — Meta template messages require it');

  // Render from personalized copy when one exists and validates, else template.
  const link = effectiveLink(campaign, contact);
  const personalizedRaw = await db.personalizedMessage.findUnique({
    where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: send.stepKey } },
  });
  const mergeOpts = {
    firstName: contact.name.split(' ')[0] || contact.name,
    lastName: contact.name.split(' ').slice(1).join(' '),
    company: contact.account,
    topic: campaign.name,
    link,
    date: campaign.date,
    speaker: campaign.speakerName ?? '',
  };
  const body = renderMergeFields(personalizedRaw ? personalizedRaw.body : template.body, mergeOpts);

  const validation = validateRenderedMessageForChannel(null, body, false, link, channel);
  if (!validation.valid) {
    const detail = validation.issues.map((i) => i.message).join('; ').slice(0, 280);
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: `Content rejected: ${detail}` } });
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
    const activeSendMode = await getSendMode();
    const rawPhone = (activeSendMode === 'live' ? contact.phone || '' : await sandboxTargetPhone());
    const targetPhone = rawPhone.replace(/[^\d+]/g, '');
    if (!targetPhone) return skip('Contact has no valid phone number on file');

    // The lead must exist in LeadSquared first (trigger strategy attaches the
    // activity to it; direct strategy keeps CRM state consistent too).
    let lsqLeadId = contact.lsqLeadId;
    if (!lsqLeadId && contact.email && activeSendMode === 'live') {
      const result = await createOrUpdateLead([
        { Attribute: 'EmailAddress', Value: contact.email },
        { Attribute: 'FirstName', Value: contact.name.split(' ')[0] || contact.name },
        { Attribute: 'Phone', Value: contact.phone || '' },
        { Attribute: 'Company', Value: contact.account },
      ]);
      lsqLeadId = result.Message.Id;
      await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId } });
    }
    if (!lsqLeadId && activeSendMode === 'live') {
      return skip('No email to key a LeadSquared lead on and none synced yet');
    }

    const delivery = await deliverChannelMessage({
      channel,
      stepKey: send.stepKey,
      campaignName: campaign.name,
      message: body,
      phone: targetPhone,
      lsqLeadId: lsqLeadId || '',
      dltTemplateId: template.dltTemplateId,
      senderId: template.senderId,
    });

    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, error: null } });
    // Retract both cards this path can raise — the send failure and the earlier
    // draft-validation warning, since a delivered message proves the draft passed.
    await resolveAttentionItems(campaignId, [
      `${channel.toUpperCase()} send failed for ${contact.name}`,
      `${channel.toUpperCase()} draft for ${contact.name} failed validation`,
    ]);
    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Sent ${channel.toUpperCase()} "${template.label}" to ${contact.name} (${delivery.strategyUsed}: ${delivery.detail})${activeSendMode !== 'live' ? ' — sandboxed → allowlisted phone' : ''}`,
        dot: 'var(--success-500)',
      },
    });
    return 'sent';
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 280);
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: message } });
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
