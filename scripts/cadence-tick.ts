/**
 * The actual "clock" that makes the cadence autonomous. Every server action
 * that fires sends (launch, retry, run-now, attendance import) only processes
 * whatever happens to already be due at the moment a human clicks something —
 * nothing in the app polls on its own. This script is that missing poll: run
 * it on a schedule (cron / systemd timer / etc.) and every campaign whose
 * cadence is `running` gets its due sends processed, same as clicking
 * "Run due sends now" in the Control Center, just without a human there.
 *
 *   npm run cadence:tick
 *
 * Safe to run concurrently with the dev server and safe to run on an overlap
 * (e.g. two ticks racing) — every send this touches is guarded by the same
 * dueAt/status filters and the CadenceSend unique constraint the UI paths use,
 * so a doubled tick can't double-send.
 */
// `dotenv/config` on its own only reads `.env`, never `.env.local` — every real
// secret this app uses (LSQ_*, ANTHROPIC_API_KEY, SEND_MODE, SEND_ALLOWLIST_LEAD_EMAIL)
// lives in `.env.local`, so a plain `import 'dotenv/config'` here silently ran
// with all of them undefined. It also doesn't strip a literal backslash the way
// Next's own loader does — LSQ_ACCESS_KEY in this project contains a `\$`, and
// plain dotenv keeps the backslash (producing a key LeadSquared rejects as
// "Invalid User Details") while Next's loader strips it correctly. Use the same
// loader Next itself uses so this script sees exactly what the running app sees.
import '../lib/loadEnv';
import { db } from '../lib/db';
import { processDueSends } from '../lib/cadence';

async function main() {
  const running = await db.campaign.findMany({
    where: { cadenceStatus: 'running' },
    select: { id: true, name: true },
  });

  if (running.length === 0) {
    console.log('cadence-tick: no campaigns with cadenceStatus=running — nothing to do.');
    return;
  }

  let totalSent = 0;
  let totalFailed = 0;

  for (const campaign of running) {
    const result = await processDueSends(campaign.id);
    if (result.processed > 0) {
      console.log(`cadence-tick: "${campaign.name}" (${campaign.id}) — processed ${result.processed}, sent ${result.sent}, failed ${result.failed}`);
    }
    totalSent += result.sent;
    totalFailed += result.failed;
  }

  console.log(`cadence-tick: done — ${running.length} running campaign(s) checked, ${totalSent} sent, ${totalFailed} failed.`);
}

main()
  .catch((e) => {
    console.error('cadence-tick failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
