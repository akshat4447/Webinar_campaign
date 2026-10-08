import { wallClockToDate } from '@/lib/dateFormat';
import { refreshLsqExclusions } from '@/lib/lsqExclusions';
import { assertLaunchReady } from '@/lib/launchReadiness';
import { sendEligibility } from '@/lib/sendEligibility';
import { quotaDay, reserveSendQuota, releaseSendQuota } from '@/lib/sendQuota';
import { db } from '@/lib/db';
import { deliverOnce, DeliveryUnknownError } from '@/lib/deliveryGuard';
import { createOrUpdateLead, sendEmailToLead, LeadSquaredError } from '@/lib/leadsquared';
import { resolveRecipient } from '@/lib/sendGuard';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { resolveStepDate } from '@/lib/stepSchedule';
import { isWithinSendWindow } from '@/lib/sendWindow';
import { validateRenderedMessage, validateRenderedMessageForChannel } from '@/lib/messageValidation';
import { normalizeChannel, isAutomatableChannel, isContactEligibleForChannel } from '@/lib/channels';
import { deliverChannelMessage, getChannelDeliveryMode, postSentActivityIfMapped, type DeliveryChannel } from '@/lib/channelDelivery';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { appOrigin } from '@/lib/appOrigin';
import { buildInviteLink } from '@/lib/inviteLink';
import { formatSpeakersSummary } from '@/lib/speakers';
import { sendNetcoreEmail, isEmailSuppressed } from '@/lib/netcore';
import { isEmailCampaignSuppressed } from '@/lib/campaignSuppression';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';

export { isAutomatableChannel, isContactEligibleForChannel } from '@/lib/channels';

export { isLaunchQueued, isPreWebinarReminder, isPreRegistrationOutreach } from '@/lib/stepTrigger';
import { isPreWebinarReminder, isPreRegistrationOutreach } from '@/lib/stepTrigger';

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
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
  campaign: {
    id: string;
    oneClickSignup: boolean;
    registrationLink: string | null;
    zoomLink: string | null;
    zoomMeetingId?: string | null;
    name?: string | null;
    registrationMode?: string | null;
    landingPrefill?: boolean | null;
  },
  contact: {
    id: string;
    registeredAt: Date | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    account?: string | null;
    title?: string | null;
    zoomJoinUrl?: string | null;
  },
  channel: string = 'email'
): string {
  // Mode-aware (Zoom registration vs external landing page) — see lib/inviteLink.ts.
  return buildInviteLink({ campaign, contact, channel, appOrigin: appOrigin() });
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
  await assertLaunchReady(campaignId);
  await refreshLsqExclusions(campaignId);
  const [campaign, allLaunchSteps, recipients] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    db.cadenceStep.findMany({ where: { campaignId, trigger: 'launch', enabled: true, removedAt: null } }),
    db.contact.findMany({ where: { campaignId, OR: [{approved:true},{registeredAt:{not:null}}] } }),
  ]);

  const approvedContacts = recipients.filter(c=>c.approved);
  const now = new Date();

  // `isAutomatableChannel` parses a display string, which SQL cannot do, so the
  // channel half of the rule is applied here rather than in the query above.
  const steps = allLaunchSteps.filter((step) => isAutomatableChannel(step.channel));

  // Each step's send time comes from its own offset, resolved against the launch
  // moment or the webinar date. A webinar-anchored step with no date set can't be
  // scheduled, so it's skipped rather than silently queued for "now".
  const scheduled = steps
    .map((step) => ({ step, dueAt: resolveStepDate(step, { launchAt: now, webinarAt: campaign.scheduledAt }) }))
    .filter((s): s is { step: (typeof steps)[number]; dueAt: Date } => {
      if (s.dueAt === null) return false;
      // If the webinar date has already passed, pre-webinar reminders should not be scheduled
      if (s.step.anchor === 'webinar' && campaign.scheduledAt && campaign.scheduledAt < now) return false;
      return true;
    });
  const unschedulable = steps.length - scheduled.length;

  // Eligibility is per CHANNEL, not global. Requiring an email for every step
  // meant an SMS step could never reach a contact who has a mobile but no
  // usable inbox — which is exactly who an SMS invite exists for.
  const eligibleFor = (channel: string) => recipients.filter((c) => isContactEligibleForChannel(c, channel));

  // Load webinar-specific suppression entries
  const campaignSuppressions = db?.campaignSuppression?.findMany
    ? await db.campaignSuppression.findMany({
        where: { campaignId },
        select: { email: true, reason: true },
      })
    : [];
  const campSuppressedExact = new Set(
    campaignSuppressions.filter((s) => !s.email.startsWith('@')).map((s) => s.email.toLowerCase())
  );
  const campSuppressedDomains = campaignSuppressions
    .filter((s) => s.email.startsWith('@'))
    .map((s) => s.email.slice(1).toLowerCase());

  const isExcludedByCampaignSuppression = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const norm = email.trim().toLowerCase();
    if (campSuppressedExact.has(norm)) return true;
    const at = norm.indexOf('@');
    if (at !== -1) {
      const dom = norm.slice(at + 1);
      if (campSuppressedDomains.includes(dom)) return true;
    }
    return false;
  };

  const rows = scheduled.flatMap(({ step, dueAt }) => {
    const isPastLaunch = now.getTime() - dueAt.getTime() > 60_000;
    return eligibleFor(step.channel)
      .filter((contact) => {
        // Registration confirms attendance intent, independently of outreach approval.
        if (!contact.approved && !(contact.registeredAt && (isPreWebinarReminder(step.key) || step.group.toLowerCase().includes('reminder')))) return false;
        // Pre-registration outreach should not be queued for already registered contacts (if stopOnRegistration is enabled)
        if (campaign.stopOnRegistration !== false && contact.registeredAt && (isPreRegistrationOutreach(step.key) || step.group === 'Pre-registration')) {
          return false;
        }
        // Pre-webinar reminders should not be queued for unregistered contacts
        if ((isPreWebinarReminder(step.key) || step.group.toLowerCase().includes('reminder')) && !contact.registeredAt) {
          return false;
        }
        // Stop on decline: do not queue outreach for contacts who already unsubscribed
        if (campaign.stopOnDecline !== false && contact.unsubscribedAt) {
          return false;
        }
        // Stop on webinar-specific suppression list
        if (contact.email && isExcludedByCampaignSuppression(contact.email)) {
          return false;
        }
        return true;
      })
      .map((contact) => ({
        campaignId,
        contactId: contact.id,
        stepKey: step.key,
        dueAt,
        status: isPastLaunch ? 'skipped' : 'queued',
        error: isPastLaunch ? 'Past launch window (auto-skipped)' : null,
      }));
  });

  const usesSms = scheduled.some((s) => s.step.channel.toLowerCase() === 'sms');
  const usesWhatsapp = scheduled.some((s) => s.step.channel.toLowerCase() === 'whatsapp');
  const withoutEmail = approvedContacts.filter((c) => !c.email).length;
  const unverified = approvedContacts.filter((c) => c.email && c.emailSimulated && !c.emailVerified).length;
  const withoutPhone = approvedContacts.filter((c) => !c.phone).length;
  const withoutOptIn = approvedContacts.filter((c) => c.phone && !c.whatsappOptIn).length;
  const campSuppressedContactsCount = approvedContacts.filter((c) => isExcludedByCampaignSuppression(c.email)).length;
  const pastLaunchCount = rows.filter((r) => r.status === 'skipped').length;

  const skips = [
    withoutEmail ? `${withoutEmail} with no email on file (email steps)` : null,
    unverified ? `${unverified} with an unverified inferred email` : null,
    campSuppressedContactsCount ? `${campSuppressedContactsCount} excluded by webinar suppression list` : null,
    usesSms && withoutPhone ? `${withoutPhone} with no mobile number (SMS steps)` : null,
    usesWhatsapp && withoutOptIn ? `${withoutOptIn} without WhatsApp opt-in` : null,
    unschedulable ? `${unschedulable} step(s) with no resolvable date — set the webinar date in webinar setup` : null,
    pastLaunchCount ? `${pastLaunchCount} historical send(s) auto-skipped (due before launch)` : null,
  ].filter(Boolean);


  const { queued } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
    const current = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (current.cadenceStatus !== 'not_started' || current.archived || current.status === 'completed') throw new Error('This campaign cannot launch in its current state.');
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
    await tx.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'running', status: 'live', launchedAt: campaign.launchedAt ?? now } });
    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `Launched cadence: ${toCreate.length} send(s) queued across ${scheduled.length} step(s) for ${approvedContacts.length} approved contact(s)${skips.length ? ` — skipped ${skips.join('; ')}` : ''}`,
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
const MAX_PER_CALL = 100;
const BATCH_SIZE = 100;

export async function processDueSends(campaignId: string, budgetMs = 25_000): Promise<ProcessResult> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const idle = { processed: 0, sent: 0, failed: 0, remaining: 0, dailyLimitReached: false, outsideSendWindow: false };
  if (campaign.cadenceStatus !== 'running') return idle;
  // Defense in depth alongside markCampaignCompletedAction, which stops the
  // cadence explicitly: a webinar the operator has declared finished must
  // never dispatch another message, whatever cadenceStatus happens to say.
  // The completed workspace hides Control Center, so there would be no way to
  // stop a cadence that slipped through here.
  if (isCampaignCompleted(campaign.status) || campaign.archived) return idle;
  await refreshLsqExclusions(campaignId);

  // Resolved once per tick (the roster rarely changes mid-batch) and threaded
  // through every send below, so {{speaker}}/{{speakerName}}/{{speakers}} in a
  // real sent message reflects the full panel, not just the mirrored primary.
  const speakers = await db.speaker.findMany({ where: { campaignId }, orderBy: { order: 'asc' } });
  const speakersSummary = formatSpeakersSummary(speakers) || campaign.speakerName || '';

  const now = new Date();

  // Quiet-hours guard: evaluated against IST (Asia/Kolkata)
  if (!isWithinSendWindow(now, campaign.scheduleWindow, campaign.timezone)) {
    const remaining = await db.cadenceSend.count({ where: { campaignId, status: { in: ['queued', 'processing'] }, dueAt: { lte: now } } });
    return { processed: 0, sent: 0, failed: 0, remaining, dailyLimitReached: false, outsideSendWindow: remaining > 0 };
  }

  // dailyLimit counts against Asia/Kolkata day boundary consistent with scheduleWindow
  const day = quotaDay(now, campaign.timezone);
  const dayStart = wallClockToDate(`${day}T00:00`, campaign.timezone) ?? now;
  const sentToday = await db.cadenceSend.count({ where: { campaignId, status: 'sent', sentAt: { gte: dayStart } } });
  let remainingBudget = Math.max(0, campaign.dailyLimit - sentToday);

  let sent = 0;
  let failed = 0;
  let processed = 0;
  let dailyLimitReached = remainingBudget === 0;
  // Memoizes the per-step template/step-row lookups for this tick — see TickCache.
  const cache = newTickCache();

  // Stale claim recovery: reset rows stuck in 'processing' for >5 minutes (e.g. from crashed workers or aborted ticks).
  // Evaluates claimedAt (not dueAt) to prevent double-sending active backlog items.
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  await db.cadenceSend.updateMany({
    where: { campaignId, status: 'processing', claimedAt: { not: null, lte: staleThreshold } },
    data: { status: 'queued', claimedAt: null },
  });

  const deadline = Date.now() + budgetMs;
  while (processed < MAX_PER_CALL && remainingBudget > 0 && !dailyLimitReached && Date.now() < deadline) {
    const current = await db.campaign.findUnique({ where: { id: campaignId }, select: { cadenceStatus: true, status: true, archived: true } });
    if (!current || current.cadenceStatus !== 'running' || current.status === 'completed' || current.archived) break;
    // Atomically claim a batch of queued sends to prevent race conditions across concurrent ticks
    const candidateIds = await db.$transaction(async (tx) => {
      const candidates = await tx.cadenceSend.findMany({
        where: { campaignId, status: 'queued', dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
        select: { id: true },
        take: Math.min(BATCH_SIZE, remainingBudget, MAX_PER_CALL - processed),
      });
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      const claimToken = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const claimTime = new Date();
      const updated = await tx.cadenceSend.updateMany({
        where: { id: { in: ids }, status: 'queued' },
        data: { status: 'processing', claimedAt: claimTime, error: claimToken },
      });
      if (updated.count === 0) return [];
      const claimed = await tx.cadenceSend.findMany({
        where: { id: { in: ids }, status: 'processing', error: claimToken },
        select: { id: true },
      });
      return claimed.map((c) => c.id);
    });

    if (candidateIds.length === 0) break;

    const due = await db.cadenceSend.findMany({
      where: { id: { in: candidateIds } },
      include: { contact: true },
      orderBy: { dueAt: 'asc' },
    });

    for (const send of due) {
      if (Date.now() >= deadline || !(await reserveSendQuota(campaignId, day, campaign.dailyLimit, sentToday, send.id))) {
        await db.cadenceSend.updateMany({ where: { id: send.id, status: 'processing' }, data: { status: 'queued', claimedAt: null, error: null } });
        dailyLimitReached = Date.now() < deadline;
        continue;
      }
      try {
        const result = await processSingleSend(campaignId, campaign, send, speakersSummary, cache);
        // Sends that fail outright (missing template/email, or a thrown error)
        // don't count against the daily budget — the budget limits real outbound
        // mail, not bookkeeping failures.
        if (result === 'sent') {
          sent++;
          remainingBudget--;
        } else if (result === 'unknown') {
          failed++;
        } else if (result === 'skipped') {
          await releaseSendQuota(campaignId, day, send.id);
          // A compliance skip (missing phone, no opt-in, unregistered…) is neither a failure
          // nor budget spend — it's bookkeeping, visible via the row's error.
        } else {
          await releaseSendQuota(campaignId, day, send.id);
          failed++;
        }
      } catch (err) {
        if (!(err instanceof DeliveryUnknownError)) await releaseSendQuota(campaignId, day, send.id);
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await db.cadenceSend.update({
            where: { id: send.id },
            data: { status: err instanceof DeliveryUnknownError ? 'unknown' : 'failed', error: msg },
          });
        } catch {
          // Ignore secondary update error
        }
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

type StepGuardRow = { enabled: boolean; removedAt: Date | null; group: string; trigger: string; mode?: string | null } | null;


interface TickCache {
  templates: Map<string, Awaited<ReturnType<typeof resolveStepTemplate>>>;
  steps: Map<string, StepGuardRow>;
}

function newTickCache(): TickCache {
  return { templates: new Map(), steps: new Map() };
}

async function cachedTemplate(cache: TickCache, campaignId: string, stepKey: string) {
  if (!cache.templates.has(stepKey)) {
    cache.templates.set(stepKey, await resolveStepTemplate(campaignId, stepKey));
  }
  return cache.templates.get(stepKey)!;
}

async function cachedStep(cache: TickCache, campaignId: string, stepKey: string): Promise<StepGuardRow> {
  if (!cache.steps.has(stepKey)) {
    cache.steps.set(
      stepKey,
      await db.cadenceStep.findUnique({
        where: { campaignId_key: { campaignId, key: stepKey } },
        select: { enabled: true, removedAt: true, group: true, trigger: true, mode: true },
      })
    );
  }
  return cache.steps.get(stepKey)!;
}

async function processSingleSend(
  campaignId: string,
  campaign: Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>,
  send: DueSendWithContact,
  speakersSummary: string,
  cache: TickCache
): Promise<'sent' | 'failed' | 'skipped' | 'unknown'> {
    // Re-verify this row is still claimed and wasn't cancelled in-flight (e.g.
    // by markCampaignCompletedAction). Only the status is needed — the contact
    // already came along with the claimed row, so re-joining it here was
    // fetching the same record twice per send.
    const freshSend = await db.cadenceSend.findUnique({
      where: { id: send.id },
      select: { status: true },
    });
    if (!freshSend || freshSend.status !== 'processing') {
      return 'skipped';
    }
    const currentCampaign = await db.campaign.findUnique({ where: { id: campaignId } });
    if (!currentCampaign || currentCampaign.cadenceStatus !== 'running' || currentCampaign.status === 'completed' || currentCampaign.archived) {
      await db.cadenceSend.updateMany({ where: { id: send.id, status: 'processing' }, data: { status: currentCampaign?.cadenceStatus === 'paused' ? 'queued' : 'skipped', claimedAt: null, error: 'Cadence paused or stopped.' } });
      return 'skipped';
    }
    campaign = currentCampaign;
    const contact = await db.contact.findUnique({ where: { id: send.contactId, campaignId } });
    if (!contact) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: { status: 'failed', claimedAt: null, error: 'Contact not found' },
      });
      return 'failed';
    }

    // Resolves through the step's own template, then this campaign's override,
    // then the shared library, then the legacy per-campaign row. See
    // lib/messageTemplates.ts for why all four still exist.
    const template = await cachedTemplate(cache, campaignId, send.stepKey);

    // Step enablement guard: if the step was disabled or removed in the planner, skip sending
    const step = await cachedStep(cache, campaignId, send.stepKey);
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

    // Pre-registration outreach guard: Registered prospects must not receive invite or nudge outreach (if stopOnRegistration is enabled)
    const isOutreach =
      isPreRegistrationOutreach(send.stepKey) ||
      step?.group === 'Pre-registration' ||
      step?.group?.toLowerCase().includes('outreach') ||
      step?.group?.toLowerCase().includes('invite') ||
      (step?.trigger === 'launch' && !isPreWebinarReminder(send.stepKey) && !step?.group?.toLowerCase().includes('reminder'));

    if (isOutreach && !contact.approved) {
      await db.cadenceSend.updateMany({where:{id:send.id,status:'processing'},data:{status:'skipped',claimedAt:null,error:'Contact is not approved for outreach.'}});
      return 'skipped';
    }

    if (campaign.stopOnRegistration !== false && contact.registeredAt && isOutreach) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: { status: 'skipped', claimedAt: null, error: 'Contact already registered — pre-registration outreach skipped' },
      });
      return 'skipped';
    }

    // Pre-webinar reminder guard: Unregistered prospects must not receive countdown alerts
    if ((isPreWebinarReminder(send.stepKey) || step?.group?.toLowerCase().includes('reminder')) && !contact.registeredAt) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: { status: 'skipped', claimedAt: null, error: 'Contact has not registered — pre-webinar reminder skipped' },
      });
      return 'skipped';
    }

    const eligibility = await sendEligibility(campaignId, contact, template?.channel ?? 'email');
    if (!eligibility.ok) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', claimedAt: null, error: eligibility.reason } });
      return 'skipped';
    }
    // Keep confirmations queued until the personal join link is ready.
    if (contact.registeredAt && campaign.zoomMeetingId && !contact.zoomJoinUrl && step?.trigger === 'registration') {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'queued', dueAt: new Date(Date.now() + 60_000), claimedAt: null, error: 'Waiting for Zoom registration.' } });
      return 'skipped';
    }
    // Channel router — SMS/WhatsApp steps branch off before the email-specific
    // requirements (they need a phone + consent flags instead of an inbox, and
    // their own validators/transports).
    if (template) {
      const channel = normalizeChannel(template.channel);
      if (channel === 'sms' || channel === 'whatsapp') {
        return processChannelSend(campaignId, campaign, send, contact, template, channel, speakersSummary, step);
      }
    }

    if (!template || !contact.email) {
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: 'Missing template or contact email' } });
      return 'failed';
    }

    // Suppression list check before attempting send (if suppressionPreflight is enabled)
    if (campaign.suppressionPreflight !== false) {
      const suppression = await isEmailSuppressed(contact.email);
      if (suppression) {
        await db.cadenceSend.update({
          where: { id: send.id },
          data: {
            status: 'skipped',
            claimedAt: null,
            error: `Email suppressed (${suppression.reason}): ${suppression.detail || 'Address on suppression list'}`,
          },
        });
        return 'skipped';
      }

      // Webinar-specific suppression check
      const campSuppression = await isEmailCampaignSuppressed(campaignId, contact.email);
      if (campSuppression) {
        await db.cadenceSend.update({
          where: { id: send.id },
          data: {
            status: 'skipped',
            claimedAt: null,
            error: `Webinar suppression list: excluded by target "${campSuppression.matchPattern}" (${campSuppression.reason})`,
          },
        });
        return 'skipped';
      }
    }

    if (campaign.stopOnDecline !== false && contact.unsubscribedAt) {
      await db.cadenceSend.update({
        where: { id: send.id },
        data: {
          status: 'skipped',
          claimedAt: null,
          error: 'Contact unsubscribed — send skipped',
        },
      });
      return 'skipped';
    }


    // A personalized message for this contact+step wins over the shared template
    // — but only if the step is in AI personalization mode (step.mode !== 'template')
    // and passes content validation. When step.mode is 'template', the fixed template
    // is always dispatched directly with dynamic tokens auto-merged.
    const stepMode = step?.mode ?? (campaign.msgMode === 'templatized' ? 'template' : 'ai');
    const personalizedRaw = stepMode === 'ai'
      ? await db.personalizedMessage.findUnique({
          where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: send.stepKey } },
        })
      : null;
    const sendChannel = send.stepKey === 'linkedin' ? 'linkedin' : 'email';
    const link = effectiveLink(campaign, contact, sendChannel);
    // When one-click sign-up is active or registration link was updated, replace the static linkUsed
    // at generation time with the recipient's actual effective link so validation passes and links work
    let personalizedBody = personalizedRaw?.body ?? '';
    if (personalizedRaw && link && personalizedRaw.linkUsed && personalizedRaw.linkUsed !== link) {
      personalizedBody = personalizedBody.split(personalizedRaw.linkUsed).join(link);
    }
    const personalizedValidation = personalizedRaw
      ? validateRenderedMessage(personalizedRaw.subject, personalizedBody, send.stepKey !== 'linkedin', link)
      : null;
    const personalized = personalizedValidation?.valid
      ? { ...personalizedRaw, body: personalizedBody }
      : null;
    if (personalizedRaw && !personalizedValidation?.valid) {
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `Personalized copy for ${contact.name} skipped — sent the template instead`,
        detail: (personalizedValidation?.issues ?? []).map((i) => i.message).join('; ').slice(0, 600),
        actionsCsv: 'view',
      });
    }

    const mergeOpts = {
      firstName: contact.name.split(' ')[0] || contact.name,
      lastName: contact.name.split(' ').slice(1).join(' '),
      company: contact.account,
      topic: campaign.name,
      webinarTitle: campaign.name,
      link,
      zoomLink: contact.zoomJoinUrl || (!campaign.zoomMeetingId ? campaign.zoomLink : null) || link,
      registrationLink: campaign.registrationLink || link,
      date: campaign.date,
      dateTime: campaign.date,
      speaker: speakersSummary,
      speakerName: campaign.speakerName || speakersSummary,
      speakerTitle: campaign.speakerTitle || '',
      speakers: speakersSummary,
    };
    // Personalized copy is rendered too: the model is told not to leave merge
    // tokens behind, but rendering anyway means a stray one resolves instead of
    // shipping raw to a real inbox.
    const subject = send.renderedSubject ?? renderMergeFields(personalized?.subject ?? template.subject ?? campaign.name, mergeOpts);
    const body = send.renderedBody ?? renderMergeFields(personalized ? personalized.body : template.body, mergeOpts);

    // The personalized draft (if any) was already validated pre-render, above.
    // This catches what that can't: the shared TEMPLATE itself (used whenever
    // personalized is null) legitimately still contains {{tokens}} until this
    // very render step, so an unknown/misspelled one, or a link that didn't
    // survive rendering, has never been checked until now — this is the exact
    // post-render guard processChannelSend already runs for SMS/WhatsApp;
    // email was the one channel that could still ship broken content as-is.
    const finalValidation = validateRenderedMessageForChannel(subject, body, true, link, 'email');
    if (!finalValidation.valid) {
      const detail = finalValidation.issues.map((i) => i.message).join('; ').slice(0, 280);
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'failed', claimedAt: null, error: `Content rejected: ${detail}` } });
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'warning',
        title: `Email draft for ${contact.name} failed validation`,
        detail,
        actionsCsv: 'view',
      });
      return 'failed';
    }

    try {
      // Resolve the recipient first: this throws for an inferred-but-unverified
      // address, and we must not write a guessed email into the CRM either.
          const { email: recipientEmail } = resolveRecipient({ ...contact, email: send.recipient || contact.email });

      await db.cadenceSend.updateMany({ where: { id: send.id, recipient: null }, data: { recipient: recipientEmail, renderedSubject: subject, renderedBody: body, templateVersion: template.id } });
      const emailProvider = campaign.emailProvider || 'leadsquared';

      if (emailProvider === 'netcore') {
        const originalRecipient = contact.email ?? undefined; // captured: narrowing does not survive into the closure
        const netcoreOutcome = await deliverOnce(send.id, 'email', () =>
          sendNetcoreEmail({
            to: recipientEmail,
            toName: contact.name,
            subject,
            html: escapeHtml(body).replace(/\n/g, '<br/>'),
            text: body,
            tags: [campaign.id, send.stepKey],
            originalRecipient,
          })
        , { campaignId, payload: { recipient: recipientEmail, subject, body, templateId: template.id } });
        await db.cadenceSend.update({ where: { id: send.id }, data: { providerMessageId: netcoreOutcome.value?.messageId ?? null } });
        if (netcoreOutcome.duplicate) console.warn(`[cadence] send ${send.id} was already delivered via Netcore — duplicate suppressed`);

        await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, error: null, deliveryOutcome: 'accepted' } });
        await resolveAttentionItems(campaignId, [`Send failed for ${contact.name}`]);

        // Dual-logging: If LeadSquared has a lead ID for this contact, log "Email Sent (via Netcore)"
        // to the lead's CRM timeline so SDRs retain full touchpoint history.
        if (contact.lsqLeadId) {
          try {
            await postSentActivityIfMapped({
              channel: 'email',
              lsqLeadId: contact.lsqLeadId,
              campaignName: campaign.name,
              stepKey: send.stepKey,
              note: `Email "${template.label}" delivered via Netcore Cloud`,
            });
          } catch {
            /* mapping hook must never fail the email itself */
          }
        }

        await db.activityLogEntry.create({
          data: {
            campaignId,
            text: `Sent "${template.label}" to ${contact.name} via Netcore${personalized ? ' (personalized)' : ''}`,
            dot: 'var(--success-500)',
          },
        });
        return 'sent';
      }

      // Default LeadSquared email sending
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

      const lsqOutcome = await deliverOnce(send.id, 'email', () =>
        sendEmailToLead({
          recipientEmail,
          subject,
          contentHtml: escapeHtml(body).replace(/\n/g, '<br/>'),
          contentText: body,
        }), { campaignId, payload: { recipient: recipientEmail, subject, body, templateId: template.id } }
      );
      if (lsqOutcome.duplicate) console.warn(`[cadence] send ${send.id} was already delivered via LeadSquared — duplicate suppressed`);

      await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, error: null, deliveryOutcome: 'accepted' } });
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
          text: `Sent "${template.label}" to ${contact.name}${personalized ? ' (personalized)' : ''}`,
          dot: 'var(--success-500)',
        },
      });
      return 'sent';
    } catch (err) {
      const message = err instanceof LeadSquaredError ? err.message : (err instanceof Error ? err.message : String(err));
      await db.cadenceSend.update({ where: { id: send.id }, data: { status: err instanceof DeliveryUnknownError ? 'unknown' : 'failed', deliveryOutcome: err instanceof DeliveryUnknownError ? 'unknown' : 'failed', claimedAt: null, error: message } });
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: `Send failed for ${contact.name}`,
        detail: message.slice(0, 600),
        actionsCsv: 'retry',
      });
      return err instanceof DeliveryUnknownError ? 'unknown' : 'failed';
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
  channel: DeliveryChannel,
  speakersSummary: string,
  step?: StepGuardRow
): Promise<'sent' | 'failed' | 'skipped' | 'unknown'> {
  const skip = async (reason: string): Promise<'skipped'> => {
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'skipped', claimedAt: null, error: reason } });
    return 'skipped';
  };

  if (!contact.phone) return skip('No mobile number on file for this contact');
  if (channel === 'sms' && contact.smsOptOut) return skip('Contact has opted out of SMS');
  if (channel === 'whatsapp' && !contact.whatsappOptIn) return skip('No WhatsApp opt-in on record — Meta template messages require it');
  if (campaign.stopOnDecline !== false && contact.unsubscribedAt) return skip('Contact unsubscribed — send skipped');

  // Render from personalized copy when one exists and validates, else template.
  const link = effectiveLink(campaign, contact, channel);
  const stepMode = step?.mode ?? (campaign.msgMode === 'templatized' ? 'template' : 'ai');
  const personalizedRaw = stepMode === 'ai'
    ? await db.personalizedMessage.findUnique({
        where: { campaignId_contactId_stepKey: { campaignId, contactId: contact.id, stepKey: send.stepKey } },
      })
    : null;
  let personalizedBody = personalizedRaw?.body;
  if (personalizedBody && link && personalizedRaw?.linkUsed && personalizedRaw.linkUsed !== link) {
    personalizedBody = personalizedBody.split(personalizedRaw.linkUsed).join(link);
  }
  const mergeOpts = {
    firstName: contact.name.split(' ')[0] || contact.name,
    lastName: contact.name.split(' ').slice(1).join(' '),
    company: contact.account,
    topic: campaign.name,
    webinarTitle: campaign.name,
    link,
    zoomLink: contact.zoomJoinUrl || (!campaign.zoomMeetingId ? campaign.zoomLink : null) || link,
    registrationLink: campaign.registrationLink || link,
    date: campaign.date,
    dateTime: campaign.date,
    speaker: speakersSummary,
    speakerName: campaign.speakerName || speakersSummary,
    speakerTitle: campaign.speakerTitle || '',
    speakers: speakersSummary,
  };
  const body = send.renderedBody ?? renderMergeFields(personalizedBody ? personalizedBody : template.body, mergeOpts);

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
    // Retries preserve the recorded destination and rendered message.
    const rawPhone = send.recipient || contact.phone || '';
    const targetPhone = rawPhone.replace(/[^\d+]/g, '');
    if (!targetPhone) return skip('Contact has no valid phone number on file');

    // The lead must exist in LeadSquared first (trigger strategy attaches the
    // activity to it; direct strategy keeps CRM state consistent too).
    let lsqLeadId = contact.lsqLeadId;
    if (!lsqLeadId && contact.email) {
      const result = await createOrUpdateLead([
        { Attribute: 'EmailAddress', Value: contact.email },
        { Attribute: 'FirstName', Value: contact.name.split(' ')[0] || contact.name },
        { Attribute: 'Phone', Value: contact.phone || '' },
        { Attribute: 'Company', Value: contact.account },
      ]);
      lsqLeadId = result.Message.Id;
      await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId } });
    }
    const deliveryMode = await getChannelDeliveryMode(channel as DeliveryChannel);
    if (!lsqLeadId && deliveryMode === 'trigger') {
      return skip('No email to key a LeadSquared lead on and none synced yet for trigger-based delivery');
    }

    await db.cadenceSend.updateMany({ where: { id: send.id, recipient: null }, data: { recipient: targetPhone, renderedBody: body, templateVersion: template.label } });
    const deliveryOutcome = await deliverOnce(send.id, channel, () =>
      deliverChannelMessage({
        channel,
        stepKey: send.stepKey,
        campaignName: campaign.name,
        message: body,
        phone: targetPhone,
        lsqLeadId: lsqLeadId || '',
        dltTemplateId: template.dltTemplateId,
        senderId: template.senderId,
      }), { campaignId, payload: { recipient: targetPhone, body, templateId: template.label } }
    );
    // Already dispatched by an earlier attempt that died before marking the row sent.
    const delivery = deliveryOutcome.value ?? { strategyUsed: 'direct', detail: 'Previously accepted by the provider.' };

    await db.cadenceSend.update({ where: { id: send.id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, error: null, deliveryOutcome: delivery.strategyUsed === 'trigger' ? 'queued' : 'accepted' } });
    // Retract both cards this path can raise — the send failure and the earlier
    // draft-validation warning, since a delivered message proves the draft passed.
    await resolveAttentionItems(campaignId, [
      `${channel.toUpperCase()} send failed for ${contact.name}`,
      `${channel.toUpperCase()} draft for ${contact.name} failed validation`,
    ]);
    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Sent ${channel.toUpperCase()} "${template.label}" to ${contact.name} (${delivery.strategyUsed}: ${delivery.detail})`,
        dot: 'var(--success-500)',
      },
    });
    return 'sent';
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 280);
    await db.cadenceSend.update({ where: { id: send.id }, data: { status: err instanceof DeliveryUnknownError ? 'unknown' : 'failed', deliveryOutcome: err instanceof DeliveryUnknownError ? 'unknown' : 'failed', claimedAt: null, error: message } });
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: `${channel.toUpperCase()} send failed for ${contact.name}`,
      detail: message,
      actionsCsv: 'retry',
    });
    return err instanceof DeliveryUnknownError ? 'unknown' : 'failed';
  }
}
