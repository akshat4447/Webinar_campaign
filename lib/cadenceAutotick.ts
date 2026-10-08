export function startCadenceAutotick() {
  const requested = Number(process.env.CADENCE_AUTOTICK_SECONDS ?? 300);
  const seconds = Number.isFinite(requested) ? Math.max(60, requested) : 300;
  let active = false;
  const timer = setInterval(async () => {
    if (active) return;
    active = true;
    try { const { runWorkerTick } = await import('@/lib/workerTick'); console.log('[worker]', await runWorkerTick()); }
    catch (err) { console.error('[worker] tick failed', err); }
    finally { active = false; }
  }, seconds * 1000);
  timer.unref?.();
}
