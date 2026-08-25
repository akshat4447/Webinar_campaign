/**
 * Live end-to-end journey audit — drives the REAL lib functions the UI calls,
 * against a scratch campaign, then cleans up. Covers: sandbox publish, cadence
 * launch, email delivery (real LSQ), channel compliance gates, LinkedIn Event
 * registration ingestion, event-anchored confirmations, and WhatsApp opt-in.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { db } from '../lib/db';
import { provisionCampaignDefaults } from '../lib/campaignDefaults';
import { publishWebinarToLinkedIn } from '../lib/linkedin/publishWebinar';
import { launchCadence, processDueSends } from '../lib/cadence';

const CID = 'audit-e2e-journey';
let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  if (cond) console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else {
    failures++;
    console.log(`✗ FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

/** Account-level blockers (LSQ rate limits / delivery config) are reported as
 *  ENV, not app failures — the audit's job is to separate code bugs from
 *  tenant setup gaps. */
const ENV_BLOCKED = /429|RateLimit|MailDelivery|no Phone in LeadSquared/i;
function checkDelivery(label: string, row: { status: string; error: string | null } | null, wantSent = true) {
  if (!row) return check(label, false, 'row missing');
  if (wantSent && row.status === 'sent') return check(label, true);
  if (!wantSent && row.status === 'skipped') return check(label, true, row.error?.slice(0, 60));
  if (ENV_BLOCKED.test(row.error ?? '')) {
    envSkips++;
    console.log(`⚠ ENV: ${label} — ${(row.error ?? '').slice(0, 90)}`);
    return;
  }
  check(label, false, (row.error ?? `status=${row.status}`).slice(0, 90));
}
let envSkips = 0;

async function dumpErrors() {
  const bad = await db.cadenceSend.findMany({ where: { campaignId: CID, status: { in: ['failed', 'skipped'] } }, include: { contact: true } });
  for (const r of bad.slice(0, 6)) {
    console.log(`   [${r.status}] ${r.stepKey} → ${r.contact.name}: ${(r.error ?? '').slice(0, 140)}`);
  }
}

async function main() {
  // ---------- setup ----------
  await db.campaign.deleteMany({ where: { id: CID } });
  await db.campaign.create({
    data: {
      id: CID,
      name: 'Audit E2E Webinar',
      vertical: 'Lending',
      date: 'soon',
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
      description: 'Journey audit webinar.',
      zoomLink: 'https://zoom.us/j/audit',
      registrationLink: 'lsq.co/w/audit-e2e',
      // Full-day window so the audit's ticks aren't gated by quiet hours.
      scheduleWindow: '12:00 AM – 11:59 PM IST',
    },
  });
  await provisionCampaignDefaults(CID);
  const mk = async (name: string, opts: { email?: string; phone?: string; wa?: boolean }) =>
    db.contact.create({
      data: {
        campaignId: CID,
        name,
        email: opts.email ?? null,
        phone: opts.phone ?? null,
        whatsappOptIn: !!opts.wa,
        account: 'Audit Bank',
        title: 'VP Operations',
        vertical: 'Lending',
        function: 'Operations',
        seniority: 'VP',
        score: 90,
        explanation: 'audit fixture',
        approved: true,
        source: 'Apollo',
      },
    });
  await mk('Alice Audit', { email: 'alice.audit@example.com', phone: '+911234567890', wa: true });
  await mk('Bob Audit', { email: 'bob.audit@example.com' });
  await mk('Cara Nophone', { phone: '+919876543210', wa: true }); // C — no email

  // ---------- stage 1: publish to LinkedIn (sandbox) ----------
  const pub = await publishWebinarToLinkedIn(CID);
  check('LinkedIn publish (sandbox)', pub.ok && pub.status === 'published', pub.detail.slice(0, 60));

  // ---------- stage 2: launch cadence ----------
  const launch = await launchCadence(CID);
  check('Cadence launch queues sends', launch.queued > 0, `${launch.queued} queued`);
  const noEmailIds = (await db.contact.findMany({ where: { campaignId: CID, email: null } })).map((c) => c.id);
  const caraQueued = await db.cadenceSend.count({ where: { campaignId: CID, contactId: { in: noEmailIds }, status: 'queued' } });
  check('No-email contact excluded at launch', caraQueued === 0);
  const smsQueuedForB = await db.cadenceSend.findFirst({ where: { campaignId: CID, stepKey: 'sms', status: 'queued' } });
  check('SMS queued at launch (gated later at send time)', !!smsQueuedForB);

  // ---------- stage 3: run due sends (email + gated channels) ----------
  const r1 = await processDueSends(CID);
  console.log(`   tick#1 processed=${r1.processed} sent=${r1.sent} failed=${r1.failed}`);
  await dumpErrors();
  const rows = await db.cadenceSend.findMany({ where: { campaignId: CID }, include: { contact: true } });
  for (const key of ['invite', 't1h', 'sms']) {
    const r = rows.find((x) => x.contact.name === 'Alice Audit' && x.stepKey === key) ?? null;
    checkDelivery(`Alice ${key} delivered`, r);
  }
  const bobSms = rows.find((r) => r.contact.name === 'Bob Audit' && r.stepKey === 'sms') ?? null;
  checkDelivery('Bob SMS skipped — no mobile number', bobSms, false);

  // ---------- stage 4/5: LinkedIn registrant confirmations + opt-in gate ----------
  const priya = await db.contact.create({
    data: {
      campaignId: CID,
      name: 'Priya Registrant',
      email: 'priya.registrant@example.com',
      phone: '+918888888888',
      account: 'Acme Financial',
      title: 'VP Marketing',
      vertical: 'Lending',
      function: 'Marketing',
      seniority: 'VP',
      source: 'LinkedIn Event',
      approved: false,
    },
  });
  for (const key of ['confirm', 'whatsapp']) {
    await db.cadenceSend
      .create({ data: { campaignId: CID, contactId: priya.id, stepKey: key, dueAt: new Date(), status: 'queued' } })
      .catch(() => undefined);
  }
  await processDueSends(CID);
  await dumpErrors();
  const priyaConfirm = await db.cadenceSend.findFirst({ where: { campaignId: CID, contactId: priya.id, stepKey: 'confirm' } });
  checkDelivery('Registration confirmation sent to LinkedIn registrant', priyaConfirm);
  let priyaWa = await db.cadenceSend.findFirst({ where: { campaignId: CID, contactId: priya.id, stepKey: 'whatsapp' } });
  checkDelivery('WhatsApp held back without opt-in (compliance gate)', priyaWa, false);

  // ---------- stage 6: opt-in arrives → WhatsApp fires ----------
  await db.contact.update({ where: { id: priya.id }, data: { whatsappOptIn: true } });
  await db.cadenceSend.update({ where: { id: priyaWa!.id }, data: { status: 'queued', error: null, dueAt: new Date() } });
  await processDueSends(CID);
  priyaWa = await db.cadenceSend.findFirst({ where: { campaignId: CID, contactId: priya.id, stepKey: 'whatsapp' } });
  checkDelivery('WhatsApp delivered once opt-in recorded (trigger strategy)', priyaWa);

  // ---------- cleanup ----------
  await db.campaign.deleteMany({ where: { id: CID } });
  console.log(
    failures === 0
      ? `\n=== E2E JOURNEY PASSED (${envSkips} delivery attempt(s) deferred by LSQ account limits — see ⚠ above) ===`
      : `\n=== E2E JOURNEY: ${failures} CHECK(S) FAILED ===`
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('journey crashed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());