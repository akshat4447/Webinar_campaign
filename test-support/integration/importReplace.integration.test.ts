import { it, expect, afterAll, beforeAll, vi, describe } from 'vitest';
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
import { db } from '@/lib/db';
import { startFakeLsq, type FakeLsq } from '../fakes/lsqFake';
import { importFromLsqListAction, importCsvAction } from '@/lib/actions/setup';

// Picking a second LeadSquared list (or file) used to add its contacts to the first one's, so both went into the
// next step. A new import now replaces the audience unless the operator asks to add to it.

let fake: FakeLsq;
const made: string[] = [];

beforeAll(async () => {
  process.env.LSQ_ACCESS_KEY = 'k';
  process.env.LSQ_SECRET_KEY = 's';
  process.env.LSQ_HOST = 'api.example.com';
  fake = await startFakeLsq({});
  process.env.LSQ_API_BASE_URL = fake.url;
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  await fake?.stop();
});

function list(name: string, emails: string[]) {
  return fake.seedList(name, emails.map((e, i) => fake.seedLead({ EmailAddress: e, FirstName: `P${i}`, LastName: name, Company: 'Acme', JobTitle: 'VP' }).id));
}
async function campaign() {
  const c = await db.campaign.create({ data: { name: 'Import replace', vertical: 'x', date: 'x' } });
  made.push(c.id);
  return c.id;
}
async function fetchList(id: string, listId: string, mode?: 'replace' | 'add') {
  let res = await importFromLsqListAction(id, listId, 'L', undefined, mode);
  while (res.ok && res.done === false && res.cursor) res = await importFromLsqListAction(id, listId, 'L', res.cursor, mode);
  return res;
}
const emails = async (id: string) => (await db.contact.findMany({ where: { campaignId: id }, select: { email: true } })).map((c) => c.email).sort();
const csv = (rows: string[]) => {
  const fd = new FormData();
  fd.set('file', new File([`Name,Email,Company,Title\n${rows.map((r) => `${r.split('@')[0]},${r},Acme,VP`).join('\n')}`], 'people.csv', { type: 'text/csv' }));
  return fd;
};

describe('LeadSquared list', () => {
  it('replaces the first list with the second, so only the list you picked last is used', async () => {
    const a = list('A', ['a1@a.example', 'a2@a.example', 'a3@a.example']);
    const b = list('B', ['b1@b.example', 'b2@b.example']);
    const id = await campaign();
    expect(await fetchList(id, a.id, 'replace')).toMatchObject({ ok: true, rowCount: 3 });
    expect(await emails(id)).toHaveLength(3);
    const res = await fetchList(id, b.id, 'replace');
    expect(res).toMatchObject({ ok: true, replaced: { removed: 3, keptRegistered: 0 } });
    expect(res.logLines?.join('\n')).toContain('Replaced the previous audience: 3 contacts removed');
    expect(await emails(id)).toEqual(['b1@b.example', 'b2@b.example']);
    expect((await db.campaign.findUniqueOrThrow({ where: { id } })).lsqListId).toBe(b.id);
  });

  it('adds when asked to, merging people who are in both lists once', async () => {
    const a = list('A2', ['x1@a.example', 'both@a.example']);
    const b = list('B2', ['both@a.example', 'y1@b.example']);
    const id = await campaign();
    await fetchList(id, a.id, 'replace');
    const res = await fetchList(id, b.id, 'add');
    expect(res.replaced).toBeUndefined();
    expect(await emails(id)).toEqual(['both@a.example', 'x1@a.example', 'y1@b.example']);
  });

  it('removes the old contacts with their scores and approvals, but keeps anyone who has already registered', async () => {
    const a = list('A3', ['s1@a.example', 'reg@a.example']);
    const b = list('B3', ['n1@b.example']);
    const id = await campaign();
    await fetchList(id, a.id, 'replace');
    await db.contact.updateMany({ where: { campaignId: id, email: 's1@a.example' }, data: { score: 90, approved: true } });
    await db.contact.updateMany({ where: { campaignId: id, email: 'reg@a.example' }, data: { registeredAt: new Date() } });
    const res = await fetchList(id, b.id, 'replace');
    expect(res.replaced).toEqual({ removed: 1, keptRegistered: 1 });
    expect(await emails(id)).toEqual(['n1@b.example', 'reg@a.example']);
  });

  it('keeps the current audience when the new list comes back empty, and says so', async () => {
    const a = list('A4', ['k1@a.example', 'k2@a.example']);
    const empty = fake.seedList('Empty', []);
    const id = await campaign();
    await fetchList(id, a.id, 'replace');
    const res = await fetchList(id, empty.id, 'replace');
    expect(res).toMatchObject({ ok: true, warning: expect.stringContaining('already imported were kept') });
    expect(res.replaced).toBeUndefined();
    expect(await emails(id)).toEqual(['k1@a.example', 'k2@a.example']);
  });

  it('with no mode given behaves as before: adds', async () => {
    const a = list('A5', ['d1@a.example']);
    const b = list('B5', ['d2@b.example']);
    const id = await campaign();
    await fetchList(id, a.id);
    await fetchList(id, b.id);
    expect(await emails(id)).toEqual(['d1@a.example', 'd2@b.example']);
  });

  it('is refused once the webinar has launched, so nothing already sent can be touched', async () => {
    const a = list('A6', ['z1@a.example']);
    const id = await campaign();
    await db.campaign.update({ where: { id }, data: { cadenceStatus: 'running', status: 'live' } });
    expect(await importFromLsqListAction(id, a.id, 'L', undefined, 'replace')).toMatchObject({ ok: false });
  });
});

describe('CSV file', () => {
  it('replaces the earlier file by default from the screen, and adds when asked', async () => {
    const id = await campaign();
    const first = csv(['c1@c.example', 'c2@c.example']);
    first.set('mode', 'replace');
    await importCsvAction(id, first);
    const second = csv(['c3@c.example']);
    second.set('mode', 'replace');
    expect(await importCsvAction(id, second)).toMatchObject({ ok: true, replaced: { removed: 2 } });
    expect(await emails(id)).toEqual(['c3@c.example']);
    const third = csv(['c4@c.example']);
    third.set('mode', 'add');
    await importCsvAction(id, third);
    expect(await emails(id)).toEqual(['c3@c.example', 'c4@c.example']);
  });
});
