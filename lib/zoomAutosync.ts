// Node-runtime-only Zoom sync loop — same shape as lib/cadenceAutotick.ts,
// wired in from instrumentation.ts under the same guardrails: off unless
// explicitly enabled, and only does anything once Zoom is genuinely
// connected (real account, ZOOM_MODE=live).
//
// Three responsibilities, each independent so one failing never blocks
// the others:
//   1. Webinar Studio -> Zoom: create a real meeting for any campaign that
//      has a name and a future date but no linked meeting yet.
//   2. Zoom -> Webinar Studio: any meeting on the connected account with no
//      matching campaign becomes a new draft, provisioned the same way the
//      wizard provisions one.
//   3. Attendance: pull participants for any campaign whose webinar started
//      at least 2 hours ago (the same post-webinar buffer the built-in
//      "Attendee follow-up"/"No-show follow-up" steps already use) and
//      hasn't had attendance imported yet.

const DEFAULT_INTERVAL_SEC = 300;
const MIN_INTERVAL_SEC = 60;
const POST_WEBINAR_BUFFER_MS = 2 * 60 * 60 * 1000;

export function startZoomAutosync() {
  const requested = Number(process.env.ZOOM_AUTOSYNC_SECONDS ?? DEFAULT_INTERVAL_SEC);
  const intervalSec = Number.isFinite(requested) ? Math.max(MIN_INTERVAL_SEC, requested) : DEFAULT_INTERVAL_SEC;

  let running = false;

  async function createMissingMeetings() {
    const { db } = await import('@/lib/db');
    const { createMeeting } = await import('@/lib/zoom/meetings');

    const unlinked = await db.campaign.findMany({
      where: { zoomMeetingId: null, archived: false, scheduledAt: { gt: new Date() } },
      select: { id: true, name: true, scheduledAt: true, description: true },
    });
    for (const c of unlinked) {
      try {
        const meeting = await createMeeting({ topic: c.name || 'Untitled webinar', startTime: c.scheduledAt, agenda: c.description ?? undefined });
        await db.campaign.update({ where: { id: c.id }, data: { zoomLink: meeting.joinUrl, zoomMeetingId: meeting.id, zoomMode: 'new' } });
        console.log(`[zoom-sync] created a Zoom meeting for "${c.name}"`);
      } catch (err) {
        console.error(`[zoom-sync] could not create a Zoom meeting for "${c.name}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  async function importNewMeetings() {
    const { db } = await import('@/lib/db');
    const { listUpcomingMeetings } = await import('@/lib/zoom/meetings');
    const { formatWebinarDate } = await import('@/lib/campaignDate');
    const { provisionCampaignDefaults } = await import('@/lib/campaignDefaults');

    const [meetings, linked] = await Promise.all([
      listUpcomingMeetings(),
      db.campaign.findMany({ where: { zoomMeetingId: { not: null } }, select: { zoomMeetingId: true } }),
    ]);
    const linkedIds = new Set(linked.map((c) => c.zoomMeetingId));

    for (const m of meetings) {
      if (linkedIds.has(m.id)) continue;
      try {
        const scheduledAt = m.startTime ? new Date(m.startTime) : null;
        const campaign = await db.campaign.create({
          data: {
            name: m.topic,
            vertical: 'Unassigned',
            date: scheduledAt ? formatWebinarDate(scheduledAt) : 'Not scheduled yet',
            scheduledAt,
            zoomLink: m.joinUrl,
            zoomMeetingId: m.id,
            zoomMode: 'existing',
          },
        });
        await provisionCampaignDefaults(campaign.id);
        await db.activityLogEntry.create({
          data: { campaignId: campaign.id, text: 'Imported as a new draft from a Zoom meeting found on the connected account', dot: 'var(--accent-500)' },
        });
        console.log(`[zoom-sync] imported "${m.topic}" from Zoom as a new draft campaign`);
      } catch (err) {
        console.error(`[zoom-sync] could not import Zoom meeting "${m.topic}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  async function importDueAttendance() {
    const { db } = await import('@/lib/db');
    const { importAttendanceFromZoom } = await import('@/lib/attendance');

    const due = await db.campaign.findMany({
      where: { zoomMeetingId: { not: null }, attendanceImportedAt: null, scheduledAt: { lt: new Date(Date.now() - POST_WEBINAR_BUFFER_MS) } },
      select: { id: true, name: true },
    });
    for (const c of due) {
      try {
        const result = await importAttendanceFromZoom(c.id);
        if (result.ok) console.log(`[zoom-sync] attendance for "${c.name}": ${result.attendedCount} attended, ${result.noShowCount} no-show`);
        else console.error(`[zoom-sync] attendance pull for "${c.name}" returned an error: ${result.error}`);
      } catch (err) {
        console.error(`[zoom-sync] attendance pull failed for "${c.name}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  async function tick() {
    // A slow pass must not overlap itself — two concurrent runs could each
    // try to create the same missing meeting or import the same new one.
    if (running) return;
    running = true;
    try {
      const { getZoomMode, zoomIsConfigured } = await import('@/lib/zoom/client');
      if ((await getZoomMode()) !== 'live' || !(await zoomIsConfigured())) return;

      await createMissingMeetings();
      await importNewMeetings();
      await importDueAttendance();
    } catch (err) {
      console.error('[zoom-sync] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalSec * 1000);
  // Don't hold the process open on shutdown.
  timer.unref?.();

  console.log(`[zoom-sync] auto-sync enabled — every ${intervalSec}s, only while Zoom is connected and ZOOM_MODE=live`);
}
