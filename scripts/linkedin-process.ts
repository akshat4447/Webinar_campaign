/**
 * Cron-shaped drain of the LinkedIn registration queue — the counterpart of
 * cadence-tick for lead sync. The webhook already processes inline via
 * after(); this covers rows that failed mid-pipeline (Claude/LeadSquared
 * outages) and environments where after() didn't get to run.
 *
 *   npm run linkedin:process
 */
// Same env loader the other scripts use — plain dotenv/config misses
// .env.local entirely and mangles escaped secrets (see scripts/cadence-tick.ts).
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';
import { processPendingLinkedinRegistrations } from '../lib/linkedin/ingest';

async function main() {
  const pending = await db.linkedinRegistration.count({ where: { processedAt: null } });
  if (pending === 0) {
    console.log('linkedin-process: no pending registrations.');
    return;
  }

  const result = await processPendingLinkedinRegistrations(100);
  console.log(
    `linkedin-process: ${pending} pending → ${result.processed} processed, ${result.skipped} skipped (no data/unmapped), ${result.failed} still failing (will retry next run).`
  );
}

main()
  .catch((e) => {
    console.error('linkedin-process failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());