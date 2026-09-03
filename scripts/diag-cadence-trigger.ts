// Proves that a cadence step invented by the operator actually queues sends.
//
// This is the regression that motivated replacing the AUTOMATED_STEP_KEYS
// allowlist with a per-step `trigger` column: an added step used to render
// correctly, report itself enabled, and then silently never send anything.
// The failure had nothing to fail, so nothing showed it.
//
// Creates a throwaway campaign, adds a step with a key that appears in no
// allowlist anywhere, launches, asserts the step queued, and deletes the
// campaign. Only queues — sending happens on a separate tick — so this is safe
// to run against a real database.
//
//   npx tsx scripts/diag-cadence-trigger.ts
import { db } from '@/lib/db';
import { launchCadence } from '@/lib/cadence';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';

(async () => {
  const c = await db.campaign.create({
    data: {
      name: 'C3 verification (temp)',
      vertical: 'Test',
      date: 'Oct 1, 2026',
      scheduledAt: new Date(Date.now() + 14 * 864e5),
      registrationLink: 'https://example.com/r',
    },
  });
  await provisionCampaignDefaults(c.id);
  await db.contact.createMany({
    data: [1, 2, 3].map((n) => ({
      campaignId: c.id,
      name: `Tester ${n}`,
      email: `tester${n}@example.com`,
      account: 'Acme',
      vertical: 'Test',
      title: 'Head of Ops',
      function: 'Operations',
      seniority: 'Head',
      approved: true,
      emailVerified: true,
    })),
  });

  // A step the operator invented: a key that appears in no allowlist anywhere.
  await db.cadenceStep.create({
    data: {
      campaignId: c.id,
      key: 'operator-added-second-nudge',
      group: 'Pre-registration',
      title: 'Second nudge',
      timing: '+2 days',
      channel: 'Email',
      desc: 'Added by hand in the planner',
      trigger: 'launch',
      offsetValue: 2,
      offsetUnit: 'days',
      anchor: 'launch',
    },
  });

  // A step the operator removed. Must not queue anything: leaving it live
  // would send a message from a step they believe is gone.
  await db.cadenceStep.create({
    data: {
      campaignId: c.id,
      key: 'operator-removed-step',
      group: 'Pre-registration',
      title: 'Removed step',
      timing: '+3 days',
      channel: 'Email',
      desc: 'Removed in the planner',
      trigger: 'launch',
      offsetValue: 3,
      offsetUnit: 'days',
      anchor: 'launch',
      createdByUser: true,
      removedAt: new Date(),
    },
  });

  const result = await launchCadence(c.id);

  const sends = await db.cadenceSend.groupBy({
    by: ['stepKey'],
    where: { campaignId: c.id },
    _count: true,
  });
  const custom = sends.find((s) => s.stepKey === 'operator-added-second-nudge');

  console.log('launch result:', JSON.stringify(result));
  console.log('steps that queued sends:', sends.map((s) => `${s.stepKey}(${s._count})`).sort().join(' '));
  console.log('');
  console.log('CUSTOM STEP QUEUED:', custom ? `YES — ${custom._count} sends` : 'NO — REGRESSION');
  console.log('linkedin queued (should be absent):', sends.some((s) => s.stepKey === 'linkedin') ? 'PRESENT — BUG' : 'absent, correct');
  console.log('confirm queued (should be absent):', sends.some((s) => s.stepKey === 'confirm') ? 'PRESENT — BUG' : 'absent, correct');
  console.log('attend queued (should be absent):', sends.some((s) => s.stepKey === 'attend') ? 'PRESENT — BUG' : 'absent, correct');
  const removedQueued = sends.some((s) => s.stepKey === 'operator-removed-step');
  console.log('removed step queued (should be absent):', removedQueued ? 'PRESENT — BUG' : 'absent, correct');

  await db.campaign.delete({ where: { id: c.id } });
  console.log('');
  console.log('temp campaign deleted');
  process.exit(custom && !removedQueued ? 0 : 1);
})();
