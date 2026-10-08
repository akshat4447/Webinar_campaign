import { db } from '@/lib/db';
import type { Prisma } from '@/lib/generated/prisma/client';
import { after } from 'next/server';
import { resolveStepDate } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';
import { isAutomatableChannel, isContactEligibleForChannel } from '@/lib/channels';
import { PRE_WEBINAR_REMINDER_KEYS, isPreWebinarReminder } from '@/lib/stepTrigger';
import { registrationAvailability, type ClosedReason } from '@/lib/registrationAvailability';

export type RegisterResult =
  | { ok: false; reason: 'unknown-campaign' | 'unknown-contact' }
  | { ok: false; reason: 'closed'; closedReason: ClosedReason }
  | { ok: true; alreadyRegistered: boolean; joinUrl: string | null; campaignName: string; campaignId: string; scheduledAt: Date | null; queued: number };

export async function registerContact(campaignId: string, contactId: string, source: string, registeredAt?: Date, opts: { enforceAvailability?: boolean } = {}): Promise<RegisterResult> {
  const result = await db.$transaction(tx => registerContactTx(tx, campaignId, contactId, source, registeredAt, opts), { timeout: 15_000 });
  if (result.ok) {
    revalidateCampaign(campaignId);
    scheduleRegistrationJobs(contactId);
  }
  return result;
}

/** A durable job is committed first; after() only reduces latency and is safe to lose. */
export function scheduleRegistrationJobs(contactId: string) {
  try {
    after(async () => {
      const { processRegistrationJobs } = await import('@/lib/registrationJobs');
      await processRegistrationJobs({ contactId, limit: 3 });
    });
  } catch { /* CLI/tests have no Next request context; the scheduled worker drains persisted jobs. */ }
}

export async function registerContactTx(tx: Prisma.TransactionClient, campaignId: string, contactId: string, source: string, registeredAt?: Date, opts: { enforceAvailability?: boolean } = {}): Promise<RegisterResult> {
  // Serializes capacity reservations and repeat registrations for this campaign.
  await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
  const contact = await tx.contact.findUnique({ where: { id: contactId } });
  if (!campaign) return { ok: false, reason: 'unknown-campaign' };
  if (!contact || contact.campaignId !== campaignId) return { ok: false, reason: 'unknown-contact' };
  const joinUrl = contact.zoomJoinUrl || (!campaign.zoomMeetingId ? campaign.zoomLink : null) || null;
  if (contact.registeredAt) return { ok: true, alreadyRegistered: true, joinUrl, campaignName: campaign.name, campaignId, scheduledAt: campaign.scheduledAt, queued: 0 };
  if (opts.enforceAvailability) {
    const availability = registrationAvailability(campaign);
    if (!availability.open) return { ok: false, reason: 'closed', closedReason: availability.reason };
  }
  const now = new Date();
  const regSteps = await tx.cadenceStep.findMany({ where: { campaignId, trigger: 'registration', enabled: true, removedAt: null } });
  const cadenceActive = campaign.cadenceStatus === 'running' || campaign.cadenceStatus === 'paused';
  const reminderSteps = cadenceActive ? await tx.cadenceStep.findMany({ where: { campaignId, trigger: 'launch', enabled: true, removedAt: null, OR: [{ group: { contains: 'Reminders' } }, { key: { in: Array.from(PRE_WEBINAR_REMINDER_KEYS) } }] } }) : [];
    const updated = await tx.contact.updateMany({
      where: { id: contactId, registeredAt: null },
      data: { registeredAt: registeredAt ?? now, registrationSource: source },
    });
    if (updated.count === 0) {
      return { ok: true as const, alreadyRegistered: true, joinUrl, campaignName: campaign.name, campaignId, scheduledAt: campaign.scheduledAt, queued: 0 };
    }

    // Increment campaign.registrations counter atomically
    await tx.$executeRaw`UPDATE "Campaign" SET "registrations" = COALESCE("registrations", 0) + 1 WHERE "id" = ${campaignId}`;

    // Cancel pending pre-registration invite nudges for this newly registered contact (if stopOnRegistration is enabled)
    if (campaign.stopOnRegistration !== false) {
      const allSteps = await tx.cadenceStep.findMany({
        where: { campaignId },
        select: { key: true, group: true, trigger: true },
      });
      const outreachKeys = allSteps
        .filter((s) => {
          if (['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final'].includes(s.key)) return true;
          if (s.group === 'Pre-registration' || s.group?.toLowerCase().includes('outreach') || s.group?.toLowerCase().includes('invite')) return true;
          if (s.trigger === 'launch' && !isPreWebinarReminder(s.key) && !s.group?.toLowerCase().includes('reminder')) return true;
          return false;
        })
        .map((s) => s.key);

      for (const k of ['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final']) {
        if (!outreachKeys.includes(k)) outreachKeys.push(k);
      }

      await tx.cadenceSend.updateMany({
        where: {
          campaignId,
          contactId,
          stepKey: { in: outreachKeys },
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'skipped',
          error: 'Contact registered — pre-registration outreach cancelled',
        },
      });
    }

    const sendsToCreate: { campaignId: string; contactId: string; stepKey: string; dueAt: Date; status: string }[] = [];

    // Queue registration-triggered steps
    for (const step of regSteps) {
      if (!isAutomatableChannel(step.channel) || !isContactEligibleForChannel(contact, step.channel)) continue;
      // An event-anchored step has no clock of its own; it goes out now.
      const dueAt = step.anchor === 'event' ? new Date(now.getTime() + step.offsetValue * (step.offsetUnit === 'minutes' ? 60_000 : step.offsetUnit === 'hours' ? 3_600_000 : 86_400_000)) : (resolveStepDate(step, { launchAt: campaign.launchedAt ?? now, webinarAt: campaign.scheduledAt }) ?? now);
      sendsToCreate.push({ campaignId, contactId, stepKey: step.key, dueAt, status: 'queued' });
    }

    // Queue future registrant reminder countdown steps (if cadence was already launched)
    for (const step of reminderSteps) {
      if (!isAutomatableChannel(step.channel) || !isContactEligibleForChannel(contact, step.channel)) continue;
      const dueAt = resolveStepDate(step, { launchAt: campaign.launchedAt ?? now, webinarAt: campaign.scheduledAt });
      if (dueAt && dueAt >= now) {
        sendsToCreate.push({ campaignId, contactId, stepKey: step.key, dueAt, status: 'queued' });
      }
    }

    let count = 0;
    if (sendsToCreate.length > 0) {
      const created = await tx.cadenceSend.createMany({
        data: sendsToCreate,
        skipDuplicates: true,
      });
      count = created.count;
    }

    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `${contact.name} registered (${source.replace('_', '-')})${count ? ` — ${count} follow-up(s) queued` : ''}`,
        dot: 'var(--success-500)',
      },
    });


  const jobs = [
    ...(campaign.zoomMeetingId && contact.email && !contact.zoomJoinUrl ? [{ kind: 'zoom' }] : []),
    ...(source !== 'leadsquared' && contact.email ? [{ kind: 'lsq' }] : []),
    ...(campaign.lsqSuppressionListId && contact.email ? [{ kind: 'suppression' }] : []),
  ];
  if (jobs.length) await tx.registrationJob.createMany({ data: jobs.map(job => ({ ...job, campaignId, contactId })), skipDuplicates: true });
  return { ok: true, alreadyRegistered: false, joinUrl, campaignName: campaign.name, campaignId, scheduledAt: campaign.scheduledAt, queued: count };
}
