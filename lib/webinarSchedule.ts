import { db } from '@/lib/db';
import { formatWebinarDate } from '@/lib/campaignDate';
import { wallClockToDate, DEFAULT_TIMEZONE } from '@/lib/dateFormat';
import { applyOffset } from '@/lib/stepSchedule';
import { revalidateCampaign } from '@/lib/revalidate';

/**
 * Takes a datetime-local value ("2026-08-28T15:00") and stores both forms.
 * This is the *only* place `scheduledAt` is ever written — keep it that way.
 * `date` (display string) and `scheduledAt` (real timestamp) only stay in sync
 * because every write happens here, together, in one call; a second write site
 * for `scheduledAt` that forgot to also set `date` would silently desync them.
 * Historical/seeded campaigns (see prisma/seed.ts) predate this picker and can
 * hold a `date` string with no `scheduledAt` at all — that's expected for them,
 * not drift.
 *
 * Whoever calls this has already checked the person may change the date (a draft in the wizard, or a launched
 * webinar being rescheduled); this only writes it, and moves the sends still waiting on the old date.
 */
export async function writeWebinarSchedule(
  campaignId: string,
  dateTimeLocal: string,
  options: { requireFuture?: boolean } = {}
): Promise<{ ok: true; display: string; scheduledAt: Date | null } | { ok: false; error: string }> {
  if (!dateTimeLocal) {
    await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: null, date: 'Not scheduled yet' } });
    revalidateCampaign(campaignId);
    return { ok: true, display: 'Not scheduled yet', scheduledAt: null };
  }

  const zoneRow = await db.campaign.findUnique({ where: { id: campaignId }, select: { timezone: true } });
  const timezone = zoneRow?.timezone ?? DEFAULT_TIMEZONE;
  // The picker value is wall-clock time in the webinar's zone, not the server's.
  const parsed = wallClockToDate(dateTimeLocal, timezone);
  if (!parsed) return { ok: false, error: 'That date could not be read.' };
  if (options.requireFuture && parsed.getTime() <= Date.now()) return { ok: false, error: 'Choose a date and time that is still ahead.' };

  const display = formatWebinarDate(parsed, timezone);
  await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: parsed, date: display } });

  // Rescheduling anchor synchronization: update dueAt for all queued sends anchored to the webinar
  const webinarSteps = await db.cadenceStep.findMany({
    where: { campaignId, anchor: 'webinar' },
    select: { key: true, offsetValue: true, offsetUnit: true },
  });
  for (const s of webinarSteps) {
    const newDue = applyOffset(parsed, s.offsetValue, s.offsetUnit);
    await db.cadenceSend.updateMany({
      where: { campaignId, stepKey: s.key, status: 'queued' },
      data: { dueAt: newDue },
    });
  }

  revalidateCampaign(campaignId);
  return { ok: true, display, scheduledAt: parsed };
}
