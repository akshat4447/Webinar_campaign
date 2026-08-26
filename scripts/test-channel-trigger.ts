/**
 * Fires ONE real trigger activity so you can prove the LSQ Automation wiring
 * without waiting for cadence timing:
 *
 *   npx tsx scripts/test-channel-trigger.ts            → uses first running campaign
 *   npx tsx scripts/test-channel-trigger.ts sms        → force channel
 *   npx tsx scripts/test-channel-trigger.ts whatsapp "Full Name"
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';
import { createOrUpdateLead } from '../lib/leadsquared';
import { deliverChannelMessage, ensureTriggerActivityTypeId } from '../lib/channelDelivery';

async function main() {
  const channel = (process.argv[2] as 'sms' | 'whatsapp' | undefined) ?? 'sms';
  const nameFilter = process.argv[3];

  const campaign = await db.campaign.findFirst({
    where: { cadenceStatus: 'running', ...(nameFilter ? { contacts: { some: { name: { contains: nameFilter } } } } : {}) },
    select: { id: true, name: true },
  });
  const contact = await db.contact.findFirst({
    where: { campaignId: campaign?.id, approved: true },
    orderBy: { score: 'desc' },
    select: { id: true, name: true, email: true, phone: true, lsqLeadId: true },
  });
  if (!campaign || !contact) {
    console.log('No running campaign with an approved contact found. Launch one first.');
    return;
  }

  console.log(`Firing ${channel.toUpperCase()} trigger on "${contact.name}" in "${campaign.name}"…`);

  let lsqLeadId = contact.lsqLeadId;
  if (!lsqLeadId && contact.email) {
    const r = await createOrUpdateLead([
      { Attribute: 'EmailAddress', Value: contact.email },
      { Attribute: 'FirstName', Value: contact.name.split(' ')[0] || contact.name },
      { Attribute: 'Company', Value: '' },
    ]);
    lsqLeadId = r.Message.Id;
    await db.contact.update({ where: { id: contact.id }, data: { lsqLeadId } });
  }
  if (!lsqLeadId) {
    console.log('✗ Contact has no LSQ lead id and no email to create one.');
    return;
  }

  await ensureTriggerActivityTypeId();
  const res = await deliverChannelMessage({
    channel,
    stepKey: 'audit-test',
    campaignName: campaign.name,
    message: `Audit test ${channel.toUpperCase()} for {{name}} — safe to ignore`.replace('{{name}}', contact.name),
    phone: '+900000000000',
    lsqLeadId,
  });
  console.log(`→ strategy=${res.strategyUsed}\n→ ${res.detail}`);
  console.log('\nNext: check the lead timeline in LSQ for the WebinarAgent Channel Trigger activity.');
  console.log('If your dispatcher automation is published and active, the SMS/WhatsApp goes out from there.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());