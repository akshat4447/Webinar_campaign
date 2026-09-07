/**
 * One-time backfill: t3/t1d/t1h were added to lib/demo-data.ts's templatesData
 * (they were missing before — see the comment above those entries) but
 * provisionCampaignDefaults only runs when a *new* campaign is created, so
 * every existing campaign is still missing those three Template rows. Their
 * CadenceStep rows already exist (those were never missing), which is exactly
 * why sends for those steps have been failing with "Missing template or
 * contact email" — the step existed and got scheduled, but had nothing to send.
 *
 * provisionCampaignDefaults upserts with `update: {}`, so running it again on
 * an already-provisioned campaign only fills in what's missing; it never
 * touches or overwrites an existing template.
 *
 *   npm run backfill:templates
 */
import '../lib/loadEnv';

import { db } from '../lib/db';
import { provisionCampaignDefaults } from '../lib/campaignDefaults';

async function main() {
  const campaigns = await db.campaign.findMany({ select: { id: true, name: true } });
  for (const c of campaigns) {
    await provisionCampaignDefaults(c.id);
  }
  console.log(`Backfilled templates/cadence steps for ${campaigns.length} campaign(s).`);

  // Sends that failed only because the template didn't exist can now succeed —
  // re-queue those specific failures (not every failure: an LSQ delivery error
  // like MXMailDeliveryException is a different, still-real problem and should
  // stay failed until the operator retries it deliberately from the UI).
  // Preserve their original dueAt schedule rather than blasting them immediately.
  const requeued = await db.cadenceSend.updateMany({
    where: { status: 'failed', stepKey: { in: ['t3', 't1d', 't1h'] }, error: 'Missing template or contact email' },
    data: { status: 'queued', error: null },
  });
  console.log(`Re-queued ${requeued.count} previously-failed t3/t1d/t1h send(s) now that their templates exist.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
