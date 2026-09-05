// End-to-end check of the one-click sign-up link.
//
// Mints a real token, follows it against the running dev server, and asserts:
//   - a valid link registers the contact and queues its registration steps
//   - clicking it AGAIN registers nothing further (mail clients prefetch,
//     scanners follow links, people double-click)
//   - a tampered link is refused
//   - a link for a contact belonging to another campaign is refused
//
// Creates a throwaway campaign and deletes it afterwards.
//
//   npx tsx scripts/diag-registration.ts [origin]

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { mintRegistrationToken } from '@/lib/registration';

const origin = process.argv[2] ?? 'http://localhost:3000';

async function follow(token: string): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${origin}/r/${token}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
}

(async () => {
  const campaign = await db.campaign.create({
    data: {
      name: 'Registration check (temp)',
      vertical: 'Test',
      date: 'Dec 3, 2026',
      scheduledAt: new Date(Date.now() + 21 * 864e5),
      zoomLink: 'https://example.zoom.us/j/registration-check',
    },
  });
  await provisionCampaignDefaults(campaign.id);

  const contact = await db.contact.create({
    data: {
      campaignId: campaign.id,
      name: 'Registration Tester',
      email: 'registration-tester@example.com',
      account: 'Acme',
      vertical: 'Test',
      title: 'Head of Ops',
      function: 'Operations',
      seniority: 'Head',
      approved: true,
      emailVerified: true,
    },
  });

  const other = await db.campaign.create({ data: { name: 'Other (temp)', vertical: 'Test', date: 'x' } });

  const fails: string[] = [];
  const token = mintRegistrationToken(campaign.id, contact.id);

  // 1. Valid link registers.
  const first = await follow(token);
  const afterFirst = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
  const queuedFirst = await db.cadenceSend.count({ where: { campaignId: campaign.id, contactId: contact.id } });
  console.log(`1. valid link      -> ${first.status} ${first.location}`);
  console.log(`   registeredAt=${afterFirst.registeredAt?.toISOString() ?? 'null'} source=${afterFirst.registrationSource} queued=${queuedFirst}`);
  if (!afterFirst.registeredAt) fails.push('valid link did not register the contact');
  if (!first.location?.includes('zoom.us')) fails.push('valid link did not redirect to the join URL');

  // 2. Same link again changes nothing.
  const second = await follow(token);
  const afterSecond = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
  const queuedSecond = await db.cadenceSend.count({ where: { campaignId: campaign.id, contactId: contact.id } });
  console.log(`2. same link twice -> ${second.status} (queued still ${queuedSecond})`);
  if (queuedSecond !== queuedFirst) fails.push(`second click queued more sends (${queuedFirst} -> ${queuedSecond})`);
  if (afterSecond.registeredAt?.getTime() !== afterFirst.registeredAt?.getTime()) fails.push('second click moved registeredAt');

  // 3. Tampered token refused.
  const [v, body, sig] = token.split('.');
  const tampered = await follow([v, body, `${sig.slice(0, -2)}xx`].join('.'));
  console.log(`3. tampered link   -> ${tampered.status} ${tampered.location}`);
  if (!tampered.location?.includes('bad-signature')) fails.push('tampered link was not refused');

  // 4. Contact from another campaign refused.
  const crossed = await follow(mintRegistrationToken(other.id, contact.id));
  console.log(`4. wrong campaign  -> ${crossed.status} ${crossed.location}`);
  if (!crossed.location?.includes('unknown-contact')) fails.push('cross-campaign link was not refused');

  await db.campaign.delete({ where: { id: campaign.id } });
  await db.campaign.delete({ where: { id: other.id } });
  console.log('\ntemp campaigns deleted');

  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log('  -', f);
    process.exit(1);
  }
  console.log('all registration checks passed');
  process.exit(0);
})();
