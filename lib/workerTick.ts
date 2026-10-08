import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';
import { reconcileRecentRegistrations } from '@/lib/registrationReconcile';
import { processAudienceJobs } from '@/lib/audienceJobs';
import { processBroadcastJobs } from '@/lib/broadcast';
import { importEndedMeetingsDue } from '@/lib/zoomEnded';
import { purgeExpired } from '@/lib/idempotency';
import { purgeExpiredOAuthStates } from '@/lib/zoom/oauthState';

export async function runWorkerTick() {
  const owner = randomUUID();
  const now = new Date();
  const lease = await db.$queryRaw<{ name: string }[]>`INSERT INTO "WorkerLease" ("name", "owner", "expiresAt") VALUES ('cadence', ${owner}, ${new Date(now.getTime() + 600_000)}) ON CONFLICT ("name") DO UPDATE SET "owner" = ${owner}, "expiresAt" = ${new Date(now.getTime() + 600_000)} WHERE "WorkerLease"."expiresAt" < ${now} RETURNING "name"`;
  if (!lease.length) return { ok: true, skipped: 'Another worker holds the lease.' };
  const errors: string[] = [];
  let processed = 0, sent = 0, failed = 0;
  const deadline = Date.now() + 55_000;
  try {
    const running = await db.campaign.findMany({ where: { cadenceStatus: 'running', archived: false, status: { not: 'completed' } }, orderBy: { updatedAt: 'asc' }, select: { id: true }, take: 50 });
    const safely = async (name: string, task: () => Promise<unknown>) => { try { return await task(); } catch (err) { errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`); } };
    await safely('registration', () => reconcileRecentRegistrations({ limit: 25, budgetMs: 10_000 }));
    for (const c of running) {
      if (Date.now() >= deadline) break;
      await safely(c.id, async () => { const r = await processDueSends(c.id, Math.min(10_000, deadline - Date.now())); processed += r.processed; sent += r.sent; failed += r.failed; await db.campaign.update({ where: { id: c.id }, data: { updatedAt: new Date() } }); });
    }
    if (Date.now() < deadline) await safely('broadcast', () => processBroadcastJobs(Math.min(20_000, deadline - Date.now())));
    if (Date.now() < deadline) await safely('attendance',()=>importEndedMeetingsDue(new Date(),Math.max(0,deadline-Date.now())));
    if (Date.now() < deadline) await safely('audience', processAudienceJobs);
    if (['1', 'true'].includes(process.env.ZOOM_AUTOSYNC ?? '') && Date.now() < deadline) await safely('zoom-sync', async () => { const { runZoomSync } = await import('@/lib/zoomAutosync'); await runZoomSync(Math.max(0,deadline-Date.now())); });
    await safely('housekeeping', async () => { await purgeExpired(); await purgeExpiredOAuthStates(); });
    const result = { ok: !errors.length, processed, sent, failed, errors, timestamp: new Date().toISOString() };
    await db.appSetting.upsert({ where: { key: 'worker.lastTick' }, create: { key: 'worker.lastTick', value: JSON.stringify(result) }, update: { value: JSON.stringify(result) } });
    return result;
  } finally { await db.workerLease.deleteMany({ where: { name: 'cadence', owner } }); }
}
