// The Overview's "Registrations By Channel": who was invited on each channel, and who registered through which. Real database.
// The invite count must follow the cadence the operator actually built, including steps they added themselves.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let overview: typeof import('@/lib/registrationChannelsServer')['getCampaignRegistrationChannels'];
const made: string[] = [];

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  overview = (await import('@/lib/registrationChannelsServer')).getCampaignRegistrationChannels;
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
});

async function webinar() {
  const c = await db.campaign.create({ data: { name: 'ZZ Channel Overview', vertical: 'Test', date: 'x', status: 'live', registrationMode: 'external', registrationLink: 'https://lp.example.com/w', selectedChannels: 'email_campaign,sms,whatsapp,linkedin,website' } });
  made.push(c.id);
  return c.id;
}
let n = 0;
async function person(campaignId: string, over: Record<string, unknown> = {}) {
  n++;
  return db.contact.create({ data: { campaignId, name: `Person ${n}`, email: `ov${n}-${Math.random().toString(36).slice(2, 6)}@example.com`, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true, ...over } });
}
async function step(campaignId: string, key: string, over: Record<string, unknown> = {}) {
  return db.cadenceStep.create({ data: { campaignId, key, title: key, timing: 'Now', channel: 'Email', desc: key, group: 'Invitations & Outreach', trigger: 'launch', mode: 'template', ...over } });
}
const send = (campaignId: string, contactId: string, stepKey: string, status = 'sent') =>
  db.cadenceSend.create({ data: { campaignId, contactId, stepKey, dueAt: new Date(), status, ...(status === 'sent' ? { sentAt: new Date() } : {}) } });
const channel = async (campaignId: string, key: string) => (await overview(campaignId, 'https://studio.example.com')).channels.find((c) => c.key === key)!;

describe('who was invited on each channel', () => {
  it('counts an invite sent through a step the operator added, which is the case the Overview used to miss', async () => {
    const id = await webinar();
    await step(id, 'custom-email-abc123', { title: 'Registration' });
    const casey = await person(id);
    await send(id, casey.id, 'custom-email-abc123');
    const email = await channel(id, 'email_campaign');
    expect(email.invitedCount).toBe(1);
    expect(email.registeredCount).toBe(0);
  });

  it('shows the invite on the email channel and the registration on the channel it came through, as in the reported case', async () => {
    const id = await webinar();
    await step(id, 'custom-email-x1');
    const invited = await person(id);
    await send(id, invited.id, 'custom-email-x1');
    const registeredViaWebsite = await person(id, { registeredAt: new Date(), registrationSource: 'website' });
    const o = await overview(id, 'https://studio.example.com');
    expect(o.channels.find((c) => c.key === 'email_campaign')).toMatchObject({ invitedCount: 1, registeredCount: 0 });
    expect(o.channels.find((c) => c.key === 'website')).toMatchObject({ registeredCount: 1 });
    expect(o.totalRegistered).toBe(1);
    void registeredViaWebsite;
  });

  it('works out the conversion when someone invited by email registers through the email link', async () => {
    const id = await webinar();
    await step(id, 'custom-email-x2');
    const a = await person(id);
    const b = await person(id);
    await send(id, a.id, 'custom-email-x2');
    await send(id, b.id, 'custom-email-x2');
    await db.contact.update({ where: { id: a.id }, data: { registeredAt: new Date(), registrationSource: 'email_campaign' } });
    const email = await channel(id, 'email_campaign');
    expect(email).toMatchObject({ invitedCount: 2, registeredCount: 1, conversionRate: 50 });
  });

  it('counts a person once, however many outreach steps reached them', async () => {
    const id = await webinar();
    await step(id, 'custom-email-first');
    await step(id, 'custom-email-second');
    const p = await person(id);
    await send(id, p.id, 'custom-email-first');
    await send(id, p.id, 'custom-email-second');
    expect((await channel(id, 'email_campaign')).invitedCount).toBe(1);
  });

  it('does not count a send that did not go out, or a reminder or confirmation to someone already registered', async () => {
    const id = await webinar();
    await step(id, 'custom-email-y');
    await step(id, 'confirm', { title: 'Confirmation', group: 'Reminders · registrants only', trigger: 'registration' });
    await step(id, 't1d', { title: 'T-1 day reminder', group: 'Reminders · registrants only' });
    const p = await person(id);
    const q = await person(id);
    const r = await person(id);
    await send(id, p.id, 'custom-email-y', 'queued');
    await send(id, q.id, 'custom-email-y', 'failed');
    await send(id, q.id, 'confirm');
    await send(id, r.id, 't1d');
    expect((await channel(id, 'email_campaign')).invitedCount).toBe(0);
  });

  it('keeps counting the people a step reached after the step is removed', async () => {
    const id = await webinar();
    const removed = await step(id, 'custom-email-gone');
    const p = await person(id);
    await send(id, p.id, 'custom-email-gone');
    await db.cadenceStep.update({ where: { id: removed.id }, data: { removedAt: new Date() } });
    expect((await channel(id, 'email_campaign')).invitedCount).toBe(1);
  });

  it('puts a step on the channel it sends on: an SMS step the operator added counts for SMS, not for email', async () => {
    const id = await webinar();
    await step(id, 'custom-sms-1', { channel: 'SMS' });
    await step(id, 'custom-wa-1', { channel: 'WhatsApp' });
    const p = await person(id);
    const q = await person(id);
    await send(id, p.id, 'custom-sms-1');
    await send(id, q.id, 'custom-wa-1');
    expect(await channel(id, 'sms')).toMatchObject({ invitedCount: 1 });
    expect(await channel(id, 'whatsapp')).toMatchObject({ invitedCount: 1 });
    expect((await channel(id, 'email_campaign')).invitedCount).toBe(0);
  });

  it('still counts the built-in invite steps, including a send whose step record no longer exists', async () => {
    const id = await webinar();
    const p = await person(id);
    const q = await person(id);
    await send(id, p.id, 'invite');
    await send(id, q.id, 'smsInvite');
    expect((await channel(id, 'email_campaign')).invitedCount).toBe(1);
    expect((await channel(id, 'sms')).invitedCount).toBe(1);
  });

  it('shows nothing invited for a webinar nobody has been sent anything for', async () => {
    const id = await webinar();
    await person(id);
    for (const key of ['email_campaign', 'sms', 'whatsapp', 'linkedin']) expect((await channel(id, key)).invitedCount, key).toBe(0);
  });
});
