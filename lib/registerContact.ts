import { db } from '@/lib/db';
import { resolveStepDate } from '@/lib/stepSchedule';

export type RegisterResult =
  | { ok: false; reason: 'unknown-campaign' | 'unknown-contact' }
  | { ok: true; alreadyRegistered: boolean; joinUrl: string | null; campaignName: string; queued: number };

/**
 * Mark a contact as registered and fire whatever the cadence says should
 * happen on registration.
 *
 * Idempotent by design: a second call returns the same success without
 * re-queueing anything. The link is clicked by mail clients prefetching, by
 * scanners, and by people twice — none of which should produce two
 * confirmation emails.
 */
export async function registerContact(
  campaignId: string,
  contactId: string,
  source: 'one_click' | 'linkedin' | 'manual' | 'import',
  /** Override for the stored timestamp — e.g. LinkedIn's own event time,
   *  which can be earlier than when this function actually runs. Due dates
   *  for queued steps still use "now": the message should go out when the
   *  registration is PROCESSED, not backdated to when it occurred. */
  registeredAt?: Date
): Promise<RegisterResult> {
  const [campaign, contact] = await Promise.all([
    db.campaign.findUnique({ where: { id: campaignId } }),
    db.contact.findUnique({ where: { id: contactId } }),
  ]);
  if (!campaign) return { ok: false, reason: 'unknown-campaign' };
  // A contact belonging to a different campaign is treated as unknown rather
  // than registered against this one — the token pins both, so a mismatch
  // means the pair was never valid.
  if (!contact || contact.campaignId !== campaignId) return { ok: false, reason: 'unknown-contact' };

  const joinUrl = campaign.zoomLink || campaign.registrationLink || null;

  if (contact.registeredAt) {
    return { ok: true, alreadyRegistered: true, joinUrl, campaignName: campaign.name, queued: 0 };
  }

  const now = campaign.simulatedNow ?? new Date();

  // Registration-triggered steps — confirmation, WhatsApp confirmation — are
  // queued for this one contact now, because until this moment there was no
  // audience for them.
  const steps = await db.cadenceStep.findMany({
    where: { campaignId, trigger: 'registration', enabled: true, removedAt: null },
  });

  const queued = await db.$transaction(async (tx) => {
    const updated = await tx.contact.updateMany({
      where: { id: contactId, registeredAt: null },
      data: { registeredAt: registeredAt ?? now, registrationSource: source },
    });
    if (updated.count === 0) {
      return null;
    }

    // Increment campaign.registrations counter atomically
    await tx.$executeRaw`UPDATE "Campaign" SET "registrations" = COALESCE("registrations", 0) + 1 WHERE "id" = ${campaignId}`;

    // Cancel pending pre-registration invite nudges for this newly registered contact
    await tx.cadenceSend.updateMany({
      where: {
        campaignId,
        contactId,
        stepKey: { in: ['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final'] },
        status: 'queued',
      },
      data: {
        status: 'skipped',
        error: 'Contact registered — invite/nudge cancelled',
      },
    });

    let count = 0;
    for (const step of steps) {
      // An event-anchored step has no clock of its own; it goes out now.
      const dueAt = step.anchor === 'event' ? now : (resolveStepDate(step, { launchAt: now, webinarAt: campaign.scheduledAt }) ?? now);
      try {
        await tx.cadenceSend.create({ data: { campaignId, contactId, stepKey: step.key, dueAt, status: 'queued' } });
        count++;
      } catch {
        // The @@unique([campaignId, contactId, stepKey]) constraint is the
        // backstop for two clicks racing each other. Losing that race is a
        // success, not an error.
      }
    }

    await tx.activityLogEntry.create({
      data: {
        campaignId,
        text: `${contact.name} registered (${source.replace('_', '-')})${count ? ` — ${count} follow-up(s) queued` : ''}`,
        dot: 'var(--success-500)',
      },
    });

    return count;
  });

  if (queued === null) {
    return { ok: true, alreadyRegistered: true, joinUrl, campaignName: campaign.name, queued: 0 };
  }

  return { ok: true, alreadyRegistered: false, joinUrl, campaignName: campaign.name, queued };
}
