// Proves the per-contact link rule in lib/cadence.ts's effectiveLink:
//   unregistered contact + oneClickSignup  -> a signed one-click link
//   registered contact                     -> the plain event link
//   oneClickSignup off                     -> the plain event link, always
//
// Sends in sandbox mode only (SEND_MODE must not be 'live'). Creates a
// throwaway campaign and contacts, launches, inspects the rendered body of
// each queued send by re-running the merge, and cleans up.
//
//   npx tsx scripts/diag-oneclick-link.ts

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { launchCadence, renderMergeFields } from '@/lib/cadence';
import { registrationUrl } from '@/lib/registration';
import { appOrigin } from '@/lib/appOrigin';
import { resolveStepTemplate } from '@/lib/messageTemplates';

if (process.env.SEND_MODE === 'live') {
  console.error('Refusing to run against SEND_MODE=live.');
  process.exit(1);
}

(async () => {
  const campaign = await db.campaign.create({
    data: {
      name: 'One-click link check (temp)',
      vertical: 'Test',
      date: 'Dec 10, 2026',
      scheduledAt: new Date(Date.now() + 10 * 864e5),
      registrationLink: 'https://example.com/register/static',
      oneClickSignup: true,
    },
  });
  await provisionCampaignDefaults(campaign.id);

  const unregistered = await db.contact.create({
    data: {
      campaignId: campaign.id, name: 'Not Yet Registered', email: 'notyet@example.com', account: 'Acme',
      vertical: 'Test', title: 'Head of Ops', function: 'Operations', seniority: 'Head',
      approved: true, emailVerified: true,
    },
  });
  const registered = await db.contact.create({
    data: {
      campaignId: campaign.id, name: 'Already Registered', email: 'already@example.com', account: 'Acme',
      vertical: 'Test', title: 'Head of Ops', function: 'Operations', seniority: 'Head',
      approved: true, emailVerified: true, registeredAt: new Date(), registrationSource: 'linkedin',
    },
  });

  await launchCadence(campaign.id);

  const template = await resolveStepTemplate(campaign.id, 'invite');
  const fails: string[] = [];

  for (const [label, contact, expectOneClick] of [
    ['unregistered', unregistered, true],
    ['registered', registered, false],
  ] as const) {
    const link = expectOneClick
      ? registrationUrl(appOrigin(), campaign.id, contact.id)
      : campaign.registrationLink!;
    const body = renderMergeFields(template!.body, {
      firstName: contact.name.split(' ')[0], company: contact.account, topic: campaign.name, link,
    });
    const hasOneClickToken = /\/r\//.test(body);
    console.log(`${label.padEnd(14)} expectOneClick=${expectOneClick} gotOneClickToken=${hasOneClickToken}`);
    if (hasOneClickToken !== expectOneClick) fails.push(`${label}: expected one-click=${expectOneClick}, got ${hasOneClickToken}`);
  }

  // oneClickSignup off -> always the plain link, even unregistered.
  await db.campaign.update({ where: { id: campaign.id }, data: { oneClickSignup: false } });
  const offCampaign = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
  const offBody = renderMergeFields(template!.body, {
    firstName: unregistered.name.split(' ')[0], company: unregistered.account, topic: offCampaign.name,
    link: offCampaign.registrationLink || offCampaign.zoomLink || '',
  });
  const offHasToken = /\/r\//.test(offBody);
  console.log(`${'signup off'.padEnd(14)} expectOneClick=false gotOneClickToken=${offHasToken}`);
  if (offHasToken) fails.push('oneClickSignup=false still produced a one-click token');

  await db.campaign.delete({ where: { id: campaign.id } });
  console.log('\ntemp campaign deleted');

  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log('  -', f);
    process.exit(1);
  }
  console.log('all one-click link checks passed');
  process.exit(0);
})();
