// Proves LinkedIn Lead Sync registrations register the contact and queue
// registration-triggered cadence steps through the SAME shared path the
// one-click link uses — not a hardcoded key list reading the legacy
// per-campaign template table.
//
// That second part was a real, live bug found while writing this: the ingest
// path queried `db.template` (the legacy per-campaign table) for the
// `confirm`/`whatsapp` steps' copy. Every campaign created since messages
// moved to the shared library (C4/C6) has ZERO rows in that table, so the
// lookup always came back empty and the block silently queued nothing — for
// every LinkedIn-driven registration on every campaign created in the last
// two checkpoints.
//
// Runs entirely in sandbox mode (LINKEDIN_MODE unset/sandbox, no network
// calls). Creates a throwaway campaign + a fabricated LinkedinRegistration
// row, processes it, and cleans up.
//
//   npx tsx scripts/diag-linkedin-registration.ts

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { processPendingLinkedinRegistrations } from '@/lib/linkedin/ingest';

if (process.env.LINKEDIN_MODE === 'live') {
  console.error('Refusing to run against LINKEDIN_MODE=live.');
  process.exit(1);
}

(async () => {
  const campaign = await db.campaign.create({
    data: {
      name: 'LinkedIn registration check (temp)',
      vertical: 'Test',
      date: 'Dec 5, 2026',
      scheduledAt: new Date(Date.now() + 14 * 864e5),
      linkedinEventUrn: 'urn:li:event:diag-check',
    },
  });
  // Provisioned through the shared library, exactly like every campaign made
  // since C6 — this is the state that exposed the bug.
  await provisionCampaignDefaults(campaign.id);
  const legacyTemplateRows = await db.template.count({ where: { campaignId: campaign.id } });

  const registration = await db.linkedinRegistration.create({
    data: {
      campaignId: campaign.id,
      responseUrn: `urn:li:leadGenFormResponse:diag-${Date.now()}`,
      eventUrn: campaign.linkedinEventUrn!,
      leadAction: 'CREATED',
      occurredAt: new Date(),
    },
  });

  const result = await processPendingLinkedinRegistrations(10, campaign.id);

  const contact = await db.contact.findFirst({ where: { campaignId: campaign.id } });
  const queued = contact
    ? await db.cadenceSend.findMany({ where: { campaignId: campaign.id, contactId: contact.id }, select: { stepKey: true } })
    : [];
  const registeredRow = await db.linkedinRegistration.findUniqueOrThrow({ where: { id: registration.id } });

  console.log(`legacy Template rows for this campaign: ${legacyTemplateRows} (0 confirms the bug's precondition)`);
  console.log(`ingest result: processed=${result.processed} failed=${result.failed} skipped=${result.skipped}`);
  console.log(`contact created: ${contact ? 'yes' : 'NO'}`);
  console.log(`contact.registeredAt: ${contact?.registeredAt?.toISOString() ?? 'null'}`);
  console.log(`contact.registrationSource: ${contact?.registrationSource ?? 'null'}`);
  console.log(`registration row processed: ${!!registeredRow.processedAt} error=${registeredRow.error ?? 'none'}`);
  console.log(`queued cadence sends: ${queued.map((q) => q.stepKey).join(', ') || '(none)'}`);

  const fails: string[] = [];
  if (!contact) fails.push('no contact was created');
  if (!contact?.registeredAt) fails.push('registeredAt was not set');
  if (contact?.registrationSource !== 'linkedin') fails.push(`registrationSource was "${contact?.registrationSource}", expected "linkedin"`);
  if (queued.length === 0) fails.push('no registration-triggered cadence sends were queued — this is the bug this script exists to catch');
  if (!queued.some((q) => q.stepKey === 'confirm')) fails.push('the confirm step specifically was not queued');

  await db.campaign.delete({ where: { id: campaign.id } });
  console.log('\ntemp campaign deleted');

  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log('  -', f);
    process.exit(1);
  }
  console.log('all LinkedIn registration checks passed');
  process.exit(0);
})();
