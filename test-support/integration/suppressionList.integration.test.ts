// The webinar's attached LeadSquared suppression list: someone already on it, who has not registered, is sent nothing. Registrants
// are put on that list by Studio itself, so they stay reachable. The exclusion lists (a separate setting) block everyone. Real
// database, fake LeadSquared server.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({ getLaunchReadiness: vi.fn(async () => ({ ok: true, problems: [] })), assertLaunchReady: vi.fn(async () => undefined) }));

import { db } from '@/lib/db';
import { startFakeLsq, type FakeLsq } from '../fakes/lsqFake';
import { refreshLsqExclusions, loadSuppressionListMembers } from '@/lib/lsqExclusions';
import { sendEligibility, excludedContactIds } from '@/lib/sendEligibility';
import { getLinkedInToolQueueAction } from '@/lib/actions/linkedin';
import { launchCadence } from '@/lib/cadence';

let fake: FakeLsq;
const made: string[] = [];
const realGap = process.env.LSQ_MIN_GAP_MS;

beforeAll(async () => {
  process.env.LSQ_ACCESS_KEY = 'k';
  process.env.LSQ_SECRET_KEY = 's';
  process.env.LSQ_HOST = 'api.example.com';
  process.env.LSQ_MIN_GAP_MS = '0';
  fake = await startFakeLsq({});
  process.env.LSQ_API_BASE_URL = fake.url;
});
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  await fake?.stop();
  if (realGap === undefined) delete process.env.LSQ_MIN_GAP_MS;
  else process.env.LSQ_MIN_GAP_MS = realGap;
});

const lead = (email: string) => fake.seedLead({ EmailAddress: email, FirstName: email.split('@')[0], LastName: 'Test' });
async function campaign(data: Record<string, unknown> = {}) {
  const c = await db.campaign.create({
    data: {
      name: 'ZZ Suppression List', vertical: 'Test', date: 'x', status: 'live', cadenceStatus: 'not_started', scheduledAt: new Date(Date.now() + 7 * 864e5),
      scheduleWindow: '00:00-23:59', msgMode: 'templatized', dailyLimit: 100, timezone: 'Asia/Calcutta', ...data,
    },
  });
  made.push(c.id);
  return c;
}
async function person(campaignId: string, email: string, data: Record<string, unknown> = {}) {
  return db.contact.create({
    data: { campaignId, name: email.split('@')[0], email, account: 'Acme', title: 'Director', function: 'Marketing', seniority: 'Director', vertical: 'Test', approved: true, ...data },
  });
}

describe('the attached suppression list', () => {
  it('holds back a person already on it who has not registered, whether they are matched by lead id or by email', async () => {
    const casey = lead('casey@example.com');
    const list = fake.seedList('Suppression', [casey.id]);
    const c = await campaign({ lsqSuppressionListId: list.id });
    await refreshLsqExclusions(c.id, true);

    const members = await loadSuppressionListMembers(c.id);
    expect(members.emails.has('casey@example.com')).toBe(true);
    expect(members.leadIds.has(casey.id)).toBe(true);

    const byLead = await sendEligibility(c.id, { email: 'other-address@example.com', lsqLeadId: casey.id }, 'email');
    expect(byLead).toMatchObject({ ok: false, reason: expect.stringContaining('suppression list') });
    const byEmail = await sendEligibility(c.id, { email: 'CASEY@Example.com', lsqLeadId: null }, 'email');
    expect(byEmail).toMatchObject({ ok: false, reason: expect.stringContaining('suppression list') });
  });

  it('does not touch anyone who is not on it', async () => {
    const list = fake.seedList('Suppression', [lead('someone@example.com').id]);
    const c = await campaign({ lsqSuppressionListId: list.id });
    await refreshLsqExclusions(c.id, true);
    expect(await sendEligibility(c.id, { email: 'free@example.com', lsqLeadId: null }, 'email')).toEqual({ ok: true });
  });

  it('keeps a person who has registered reachable, since Studio itself puts its registrants on that list', async () => {
    const reg = lead('registered@example.com');
    const list = fake.seedList('Suppression', [reg.id]);
    const c = await campaign({ lsqSuppressionListId: list.id });
    await refreshLsqExclusions(c.id, true);
    expect(await sendEligibility(c.id, { email: 'registered@example.com', lsqLeadId: reg.id, registeredAt: new Date() }, 'email')).toEqual({ ok: true });
  });

  it('is read again when a different list is attached, and forgotten when it is detached, without waiting for the cache to expire', async () => {
    const a = fake.seedList('A', [lead('a-member@example.com').id]);
    const b = fake.seedList('B', [lead('b-member@example.com').id]);
    const c = await campaign({ lsqSuppressionListId: a.id });
    await refreshLsqExclusions(c.id);
    expect((await loadSuppressionListMembers(c.id)).emails.has('a-member@example.com')).toBe(true);

    await db.campaign.update({ where: { id: c.id }, data: { lsqSuppressionListId: b.id } });
    await refreshLsqExclusions(c.id); // not forced, inside the five minutes
    const afterSwitch = await loadSuppressionListMembers(c.id);
    expect(afterSwitch.emails.has('b-member@example.com')).toBe(true);
    expect(afterSwitch.emails.has('a-member@example.com')).toBe(false);

    await db.campaign.update({ where: { id: c.id }, data: { lsqSuppressionListId: null } });
    await refreshLsqExclusions(c.id);
    expect((await loadSuppressionListMembers(c.id)).emails.size).toBe(0);
  });

  it('is not applied when no list is attached', async () => {
    const c = await campaign();
    await refreshLsqExclusions(c.id, true);
    expect((await loadSuppressionListMembers(c.id)).emails.size).toBe(0);
    expect(await sendEligibility(c.id, { email: 'anyone@example.com', lsqLeadId: null }, 'email')).toEqual({ ok: true });
  });
});

describe('the exclusion lists, a separate setting, still block everyone including a registrant', () => {
  it('blocks a registered person on an exclusion list', async () => {
    const competitor = lead('competitor@example.com');
    const list = fake.seedList('Competitors', [competitor.id]);
    const c = await campaign({ lsqExclusionListIds: JSON.stringify([list.id]) });
    await refreshLsqExclusions(c.id, true);
    const res = await sendEligibility(c.id, { email: 'competitor@example.com', lsqLeadId: competitor.id, registeredAt: new Date() }, 'email');
    expect(res.ok).toBe(false);
  });
});

describe('launching a cadence', () => {
  it('queues nothing for a person already on the suppression list and everything for the rest, and says how many were held', async () => {
    const casey = lead('casey@example.com');
    const list = fake.seedList('Suppression', [casey.id]);
    const c = await campaign({ lsqSuppressionListId: list.id });
    await db.cadenceStep.create({ data: { campaignId: c.id, key: 'invite', title: 'Invite', timing: 'Now', channel: 'Email', desc: 'Invite', group: 'Pre-registration', trigger: 'launch', mode: 'template' } });
    const held = await person(c.id, 'casey@example.com', { lsqLeadId: casey.id });
    const open = await person(c.id, 'akshat@example.com');

    await launchCadence(c.id);

    expect(await db.cadenceSend.count({ where: { campaignId: c.id, contactId: held.id } })).toBe(0);
    expect(await db.cadenceSend.count({ where: { campaignId: c.id, contactId: open.id, status: 'queued' } })).toBe(1);
    const log = await db.activityLogEntry.findFirstOrThrow({ where: { campaignId: c.id, text: { startsWith: 'Launched cadence' } } });
    expect(log.text).toContain('1 excluded by webinar suppression list');
  });
});

describe('everywhere people are picked from a list, the same people are left out', () => {
  const globalSuppressed: string[] = [];
  afterAll(async () => {
    await db.emailSuppression.deleteMany({ where: { email: { in: globalSuppressed } } });
  });

  async function setup() {
    const excl = lead('on-exclusion-list@example.com');
    const exclusionList = fake.seedList('Competitors', [excl.id]);
    const onSupp = lead('on-suppression-list@example.com');
    const registeredOnSupp = lead('registered-on-suppression-list@example.com');
    const suppressionList = fake.seedList('Suppression', [onSupp.id, registeredOnSupp.id]);
    const c = await campaign({ lsqSuppressionListId: suppressionList.id, lsqExclusionListIds: JSON.stringify([exclusionList.id]) });
    await refreshLsqExclusions(c.id, true); // reads both lists, and writes the exclusion list's people as webinar exclusions
    await db.campaignSuppression.createMany({ data: [{ campaignId: c.id, email: 'pattern-exact@example.com', reason: 'manual', source: 'manual' }, { campaignId: c.id, email: '@blocked-domain.example', reason: 'manual', source: 'manual' }] });
    await db.emailSuppression.upsert({ where: { email: 'globally-suppressed@example.com' }, create: { email: 'globally-suppressed@example.com', reason: 'bounce', provider: 'netcore' }, update: {} });
    globalSuppressed.push('globally-suppressed@example.com');
    const people = {
      free: await person(c.id, 'free@example.com'),
      unsubscribed: await person(c.id, 'unsubscribed@example.com', { unsubscribedAt: new Date() }),
      global: await person(c.id, 'GLOBALLY-suppressed@example.com'),
      exact: await person(c.id, 'Pattern-Exact@example.com'),
      domain: await person(c.id, 'anyone@blocked-domain.example'),
      exclusionList: await person(c.id, 'on-exclusion-list@example.com', { lsqLeadId: excl.id }),
      suppressionList: await person(c.id, 'on-suppression-list@example.com', { lsqLeadId: onSupp.id }),
      registeredOnSuppressionList: await person(c.id, 'registered-on-suppression-list@example.com', { lsqLeadId: registeredOnSupp.id, registeredAt: new Date() }),
    };
    return { c, people };
  }

  it('decides in bulk exactly as the send path does, for every kind of exclusion', async () => {
    const { c, people } = await setup();
    const rows = await db.contact.findMany({ where: { campaignId: c.id } });
    const excluded = await excludedContactIds(c.id, rows);
    const names = Object.fromEntries(Object.entries(people).map(([k, v]) => [v.id, k]));
    expect([...excluded].map((id) => names[id]).sort()).toEqual(['domain', 'exact', 'exclusionList', 'global', 'suppressionList', 'unsubscribed']);
    // the same answer one at a time through the send path, so the two can never disagree
    for (const row of rows) {
      const viaSend = await sendEligibility(c.id, row, 'email');
      expect(viaSend.ok, names[row.id]).toBe(!excluded.has(row.id));
    }
  });

  it('leaves nobody out when nobody is excluded, and copes with no contacts', async () => {
    const c = await campaign();
    expect((await excludedContactIds(c.id, [])).size).toBe(0);
    const free = await person(c.id, 'solo@example.com');
    expect((await excludedContactIds(c.id, [free])).size).toBe(0);
  });

  it('keeps them out of the queue the LinkedIn tool reads, and keeps everyone else in it', async () => {
    const { c, people } = await setup();
    const res = await getLinkedInToolQueueAction(c.id);
    expect(res.ok).toBe(true);
    const inQueue = new Set(res.participants.map((p) => p.id));
    expect([...inQueue].sort()).toEqual([people.free.id, people.registeredOnSuppressionList.id].sort());
  });
});
