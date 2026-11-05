// The dashboard's "Invites sent" and "Webinars in range", and the "Invites sent" on a webinar's card. Real database.
// They must agree with the Overview: an invite sent through a step the operator added counts, and a webinar set up this week for
// next week is in this week's range.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let analytics: typeof import('@/lib/analytics');
let cardCounts: typeof import('@/lib/campaignCardStats')['getCampaignCardCounts'];
const made: string[] = [];

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  analytics = await import('@/lib/analytics');
  cardCounts = (await import('@/lib/campaignCardStats')).getCampaignCardCounts;
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
});

async function webinar(over: Record<string, unknown> = {}) {
  const c = await db.campaign.create({ data: { name: 'ZZ Dashboard Counts', vertical: 'Test', date: 'x', status: 'live', ...over } });
  made.push(c.id);
  return c.id;
}
let n = 0;
async function person(campaignId: string) {
  n++;
  return db.contact.create({ data: { campaignId, name: `Person ${n}`, email: `dash${n}-${Math.random().toString(36).slice(2, 6)}@example.com`, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true } });
}
async function step(campaignId: string, key: string, over: Record<string, unknown> = {}) {
  return db.cadenceStep.create({ data: { campaignId, key, title: key, timing: 'Now', channel: 'Email', desc: key, group: 'Invitations & Outreach', trigger: 'launch', mode: 'template', ...over } });
}
const send = (campaignId: string, contactId: string, stepKey: string, status = 'sent') =>
  db.cadenceSend.create({ data: { campaignId, contactId, stepKey, dueAt: new Date(), status, ...(status === 'sent' ? { sentAt: new Date() } : {}) } });
const kpi = async (label: string) => (await analytics.getDashboardKpis('30d')).find((k) => k.label === label)!.value;
const invitesOnCard = async (id: string) => (await cardCounts([id])).get(id)?.invitesSent ?? 0;

describe('invites sent', () => {
  it('counts an invite sent through a step the operator added, on the dashboard and on the card', async () => {
    const before = Number(await kpi('Invites sent'));
    const id = await webinar();
    await step(id, 'custom-email-dash1', { title: 'Registration' });
    const p = await person(id);
    await send(id, p.id, 'custom-email-dash1');
    expect(Number(await kpi('Invites sent'))).toBe(before + 1);
    expect(await invitesOnCard(id)).toBe(1);
  });

  it('does not count a reminder, a confirmation or a send that did not go out', async () => {
    const before = Number(await kpi('Invites sent'));
    const id = await webinar();
    await step(id, 'custom-email-dash2');
    await step(id, 'confirm', { title: 'Confirmation', group: 'Reminders · registrants only', trigger: 'registration' });
    await step(id, 't1d', { title: 'T-1 day reminder', group: 'Reminders · registrants only' });
    const p = await person(id);
    const q = await person(id);
    await send(id, p.id, 'custom-email-dash2', 'queued');
    await send(id, q.id, 'confirm');
    await send(id, q.id, 't1d');
    expect(Number(await kpi('Invites sent'))).toBe(before);
    expect(await invitesOnCard(id)).toBe(0);
  });

  it('counts a person once however many outreach steps reached them, and still counts the built-in invite', async () => {
    const id = await webinar();
    await step(id, 'custom-email-dash3');
    await step(id, 'nudge', { title: 'Nudge' });
    const p = await person(id);
    const q = await person(id);
    await send(id, p.id, 'custom-email-dash3');
    await send(id, p.id, 'nudge');
    await send(id, q.id, 'invite');
    expect(await invitesOnCard(id)).toBe(2);
  });

  it('does not let one webinar\'s custom step count for another webinar with a step of the same name', async () => {
    const a = await webinar();
    const b = await webinar();
    await step(a, 'custom-shared-key');
    await step(b, 'custom-shared-key', { title: 'Thank you', group: 'Post-webinar', trigger: 'attendance' });
    const p = await person(a);
    const q = await person(b);
    await send(a, p.id, 'custom-shared-key');
    await send(b, q.id, 'custom-shared-key');
    const counts = await cardCounts([a, b]);
    expect(counts.get(a)?.invitesSent).toBe(1);
    expect(counts.get(b)?.invitesSent ?? 0).toBe(0);
  });
});

describe('webinars in range', () => {
  // The range ends before "now", so look a second later: a webinar created in the same millisecond as the query is otherwise outside it.
  const inRange = async (id: string) => (await analytics.getWebinarsInRange('30d', new Date(Date.now() + 1000), 1000)).rows.some((r) => r.id === id);

  it('includes a webinar created this week and scheduled for next week', async () => {
    const id = await webinar({ scheduledAt: new Date(Date.now() + 7 * 864e5) });
    expect(await inRange(id)).toBe(true);
  });

  it('includes a webinar held in the range even though it was created earlier', async () => {
    const id = await webinar({ scheduledAt: new Date(Date.now() - 5 * 864e5), createdAt: new Date(Date.now() - 90 * 864e5), status: 'completed' });
    expect(await inRange(id)).toBe(true);
  });

  it('leaves out a webinar created and held long ago', async () => {
    const id = await webinar({ scheduledAt: new Date(Date.now() - 120 * 864e5), createdAt: new Date(Date.now() - 150 * 864e5), status: 'completed' });
    expect(await inRange(id)).toBe(false);
  });

  it('still leaves out an old record with no real date, whatever day its row was inserted', async () => {
    const id = await webinar({ status: 'completed' });
    expect(await inRange(id)).toBe(false);
  });

  it('still includes a fresh draft with no date yet', async () => {
    const id = await webinar({ status: 'draft' });
    expect(await inRange(id)).toBe(true);
  });
});
