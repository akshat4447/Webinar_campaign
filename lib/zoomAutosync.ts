
const DEFAULT_INTERVAL_SEC = 300;
const MIN_INTERVAL_SEC = 60;
const POST_WEBINAR_BUFFER_MS = 2 * 60 * 60 * 1000;

export async function runZoomSync(budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  async function createMissingMeetings() {
    const { db } = await import('@/lib/db');
    const { createMeeting } = await import('@/lib/zoom/meetings');

    // `zoomLink: null` as well as `zoomMeetingId: null` — auto-create is only
    // for a webinar that has no event link at all. Selecting on zoomMeetingId
    // alone re-created a meeting for two campaigns that deliberately had none:
    // one the operator had just unlinked (unlinkZoomMeetingAction keeps the
    // join URL on purpose), and one where they'd pasted a non-Zoom link by
    // hand — in both cases overwriting the URL registrants had already been
    // sent, within five minutes and with no way to tell what happened.
    const unlinked = await db.campaign.findMany({
      where: { zoomMeetingId: null, zoomLink: null, archived: false, scheduledAt: { gt: new Date() } },
      take: 20, orderBy:{updatedAt:"asc"},
      select: { id: true, name: true, scheduledAt: true, description: true, timezone: true, durationMinutes: true, zoomEventType: true },
    });
    for (const c of unlinked) {
      if(Date.now()>=deadline) break;
      try {
        const meeting = await createMeeting({ topic: c.name || 'Untitled webinar', startTime: c.scheduledAt, agenda: c.description ?? undefined, timezone: c.timezone, durationMinutes: c.durationMinutes, kind: c.zoomEventType as 'meeting' | 'webinar' });
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
      if(Date.now()>=deadline) break;
      if (linkedIds.has(m.id)) continue;
      // Guard: Only import meetings that are designated webinars, workshops, or masterclasses.
      // Avoids importing personal 1:1s, team standups, and internal meetings into campaigns.
      const topicLower = (m.topic || '').toLowerCase();
      const isWebinarEvent =
        topicLower.includes('webinar') ||
        topicLower.includes('masterclass') ||
        topicLower.includes('workshop') ||
        topicLower.includes('summit') ||
        topicLower.includes('session');
      if (!isWebinarEvent && process.env.ZOOM_IMPORT_ALL_MEETINGS !== 'true') {
        continue;
      }
      try {
        const scheduledAt = m.startTime ? new Date(m.startTime) : null;
        const campaign = await db.campaign.create({
          data: {
            name: m.topic,
            vertical: 'Unassigned',
            date: scheduledAt ? formatWebinarDate(scheduledAt, m.timezone || 'Asia/Kolkata') : 'Not scheduled yet',
            scheduledAt,
            timezone: m.timezone || 'Asia/Kolkata',
            durationMinutes: m.duration || 60,
            zoomEventType: m.type || 'meeting',
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
      take:20, orderBy:{updatedAt:"asc"},
      select: { id: true, name: true },
    });
    for (const c of due) {
      if(Date.now()>=deadline) break;
      try {
        const result = await importAttendanceFromZoom(c.id);
        if (result.ok) console.log(`[zoom-sync] attendance for "${c.name}": ${result.attendedCount} attended, ${result.noShowCount} no-show`);
        else console.error(`[zoom-sync] attendance pull for "${c.name}" returned an error: ${result.error}`);
      } catch (err) {
        console.error(`[zoom-sync] attendance pull failed for "${c.name}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  async function importEnded() {
    const { importEndedMeetingsDue } = await import('@/lib/zoomEnded');
    const s = await importEndedMeetingsDue(new Date(),Math.max(0,deadline-Date.now()));
    if (s.imported || s.gaveUp) console.log(`[zoom-sync] ended-meeting attendance: ${s.imported} imported, ${s.waiting} waiting, ${s.gaveUp} gave up`);
  }

  async function reconcile() {
    const { reconcileRecentRegistrations } = await import('@/lib/registrationReconcile');
    const s = await reconcileRecentRegistrations({budgetMs:Math.max(0,deadline-Date.now()),limit:25});
    if (s.zoomFixed || s.lsqFixed) console.log(`[zoom-sync] reconciled registrations: ${s.zoomFixed} Zoom link(s), ${s.lsqFixed} LeadSquared activity(ies)`);
  }

  async function tick() {
    // A slow pass must not overlap itself — two concurrent runs could each
    // try to create the same missing meeting or import the same new one.
    const { db } = await import('@/lib/db');
    const { randomUUID } = await import('node:crypto');
    const owner = randomUUID();
    const lease = await db.$queryRaw<{ name: string }[]>`INSERT INTO "WorkerLease" ("name", "owner", "expiresAt") VALUES ('zoom', ${owner}, ${new Date(Date.now() + 600_000)}) ON CONFLICT ("name") DO UPDATE SET "owner" = ${owner}, "expiresAt" = ${new Date(Date.now() + 600_000)} WHERE "WorkerLease"."expiresAt" < NOW() RETURNING "name"`;
    if (!lease.length) return;
    try {
      const { zoomIsConfigured } = await import('@/lib/zoom/client');
      if (!(await zoomIsConfigured())) return;

      await createMissingMeetings();
      if(Date.now()<deadline) await importNewMeetings();
      if(Date.now()<deadline) await importEnded();
      if(Date.now()<deadline) await reconcile();
      if(Date.now()<deadline) await importDueAttendance();
    } catch (err) {
      console.error('[zoom-sync] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      await db.workerLease.deleteMany({ where: { name: 'zoom', owner } });
    }
  }

  await tick();
}
export function startZoomAutosync() {
  const requested = Number(process.env.ZOOM_AUTOSYNC_SECONDS ?? DEFAULT_INTERVAL_SEC);
  const intervalSec = Number.isFinite(requested) ? Math.max(MIN_INTERVAL_SEC, requested) : DEFAULT_INTERVAL_SEC;
  const timer = setInterval(() => runZoomSync().catch(err => console.error('[zoom-sync]', err)), intervalSec * 1000);
  timer.unref?.();
}
