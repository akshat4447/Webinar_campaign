// Temporary deep diagnosis for the sender + channel-trigger issue.
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';

async function main() {
  const campaigns = await db.campaign.findMany({
    where: { OR: [{ name: { contains: 'Test' } }, { name: { contains: 'test' } }, { name: { contains: 'ntitled' } }] },
    select: { id: true, name: true, cadenceStatus: true, scheduleWindow: true, simulatedNow: true },
  });
  for (const c of campaigns) {
    console.log(`\n=== ${c.name} (${c.id}) cadence=${c.cadenceStatus} window="${c.scheduleWindow}" simNow=${c.simulatedNow?.toISOString() ?? 'real'} ===`);

    const sends = await db.cadenceSend.findMany({
      where: { campaignId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 14,
      select: { stepKey: true, status: true, error: true, sentAt: true, contact: { select: { name: true } } },
    });
    for (const s of sends) {
      console.log(`  [${s.status}] ${s.stepKey} → ${s.contact.name}${s.error ? ` :: ${s.error.slice(0, 150)}` : ''}`);
    }

    const regs = await db.linkedinRegistration.findMany({ where: { campaignId: c.id }, select: { responseUrn: true, processedAt: true, error: true } });
    if (regs.length) console.log(`  registrations: ${regs.length} (${regs.filter((r) => r.processedAt).length} processed)`);

    const triggers = await db.activityLogEntry.count({ where: { campaignId: c.id, text: { contains: 'Channel Trigger' } } });
    console.log(`  channel-trigger log mentions: ${triggers}`);
  }

  console.log('\n=== global ===');
  const keys = await db.appSetting.findMany({
    where: { key: { contains: 'linkedin.' }, OR: [{ key: { contains: 'oauth' } }] },
    select: { key: true },
  });
  void keys;
  const trigType = await db.appSetting.findUnique({ where: { key: 'lsq_channel_trigger_activity_type_id' } });
  console.log('channel trigger activity type id:', trigType?.value ?? '(not created yet)');
  const senderSaved = await db.appSetting.findUnique({ where: { key: 'integration.lsq.senderEmail' } });
  console.log('senderEmail saved in DB:', senderSaved ? senderSaved.value : '(not saved)');
  console.log('LSQ_SENDER_EMAIL env present:', !!process.env.LSQ_SENDER_EMAIL);

  // Which strategies would run right now?
  const se = senderSaved?.value || process.env.LSQ_SENDER_EMAIL;
  console.log('sendEmailToLead strategies:', se ? `[UserEmailAddress(${se}) → APICaller]` : '[APICaller only]');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());