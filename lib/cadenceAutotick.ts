// Node-runtime-only half of the cadence auto-tick. Kept in its own module and
// pulled in from instrumentation.ts only under the nodejs branch, per Next's
// "Specifying the runtime" guidance — importing it unconditionally drags the
// Prisma client into the Edge instrumentation bundle, which then warns about
// node:path / node:url on every build.

const DEFAULT_INTERVAL_SEC = 300;
const MIN_INTERVAL_SEC = 60;

export function startCadenceAutotick() {
  const requested = Number(process.env.CADENCE_AUTOTICK_SECONDS ?? DEFAULT_INTERVAL_SEC);
  const intervalSec = Number.isFinite(requested) ? Math.max(MIN_INTERVAL_SEC, requested) : DEFAULT_INTERVAL_SEC;

  let running = false;

  async function tick() {
    // A slow batch must not overlap itself — processDueSends claims rows, but
    // two concurrent passes would still race on the daily-limit budget.
    if (running) return;
    running = true;
    try {
      const { db } = await import('@/lib/db');
      const { processDueSends } = await import('@/lib/cadence');
      const live = await db.campaign.findMany({ where: { cadenceStatus: 'running' }, select: { id: true, name: true } });
      for (const c of live) {
        const r = await processDueSends(c.id);
        // Only speak up when something actually happened. The send-window and
        // daily-limit guards hold sends routinely, and logging every quiet pass
        // would bury the real events.
        if (r.sent > 0 || r.failed > 0) {
          console.log(`[cadence] ${c.name}: sent ${r.sent}, failed ${r.failed}, remaining ${r.remaining}`);
        }
      }
    } catch (err) {
      console.error('[cadence] auto-tick failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalSec * 1000);
  // Don't hold the process open on shutdown.
  timer.unref?.();

  console.log(`[cadence] auto-tick enabled — every ${intervalSec}s, send window and daily limits still apply`);
}
