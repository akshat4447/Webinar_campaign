// Server-only. Turns a Zoom `meeting.ended` / `webinar.ended` webhook into a
// prompt attendance import.
//
// The webhook must answer fast, and Zoom's participant report is not always
// ready the instant a meeting ends — so the webhook only records WHEN the meeting
// ended (an AppSetting marker), and whoever ticks next (the Zoom autosync loop or
// the cron endpoint) imports attendance once a short settling delay has passed.
// That is what gets "No-show" flagged in LeadSquared within minutes of the end
// instead of waiting out the two-hour fallback poll in lib/zoomAutosync.ts.

import { db } from '@/lib/db';

const MARKER_PREFIX = 'zoom.ended.';
/** Give Zoom's participant report a moment to materialise. */
export const ENDED_SETTLE_MS = 3 * 60 * 1000;
/** Stop retrying a marker that never yields participants (the 2h fallback poll still covers it). */
export const ENDED_GIVE_UP_MS = 6 * 60 * 60 * 1000;

export async function markMeetingEnded(campaignId: string, endedAt: Date): Promise<void> {
  const key = `${MARKER_PREFIX}${campaignId}`;
  const value = endedAt.toISOString();
  await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export interface EndedImportSummary {
  checked: number;
  imported: number;
  waiting: number;
  gaveUp: number;
}

/** Imports attendance for every campaign whose meeting ended long enough ago. */
export async function importEndedMeetingsDue(now: Date = new Date(), budgetMs = 20_000): Promise<EndedImportSummary> {
  const deadline = Date.now() + budgetMs;
  const summary: EndedImportSummary = { checked: 0, imported: 0, waiting: 0, gaveUp: 0 };
  const markers = await db.appSetting.findMany({ where: { key: { startsWith: MARKER_PREFIX } }, orderBy:{value:'asc'}, take:20 });
  if (markers.length === 0) return summary;

  const { importAttendanceFromZoom } = await import('@/lib/attendance');

  for (const marker of markers) {
    if(Date.now()>=deadline) break;
    summary.checked++;
    // Rotate unsuccessful markers fairly without changing the original end time.
    const value = `${now.toISOString()}|${marker.value.split('|').at(-1)}`;
    await db.appSetting.upsert({where:{key:marker.key},create:{key:marker.key,value},update:{value}});
    const campaignId = marker.key.slice(MARKER_PREFIX.length);
    const endedMs = Date.parse(marker.value.split('|').at(-1)!);
    const age = Number.isFinite(endedMs) ? now.getTime() - endedMs : Infinity;

    if (age < ENDED_SETTLE_MS) {
      summary.waiting++;
      continue;
    }

    const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { attendanceImportedAt: true } });
    if (!campaign || campaign.attendanceImportedAt || age > ENDED_GIVE_UP_MS) {
      await db.appSetting.deleteMany({ where: { key: marker.key } });
      if (campaign && !campaign.attendanceImportedAt) summary.gaveUp++;
      continue;
    }

    try {
      const result = await importAttendanceFromZoom(campaignId);
      if (result.ok) {
        summary.imported++;
        await db.appSetting.deleteMany({ where: { key: marker.key } });
      } else {
        summary.waiting++; // typically "no participants yet" — retry on the next tick
        console.warn(`[zoom-ended] attendance for ${campaignId} not ready: ${result.error}`);
      }
    } catch (err) {
      summary.waiting++;
      console.error(`[zoom-ended] attendance import failed for ${campaignId}:`, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
