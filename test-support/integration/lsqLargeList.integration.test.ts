import { it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
import { db } from '@/lib/db';
import { startFakeLsq, type FakeLsq } from '../fakes/lsqFake';
import { importFromLsqListAction, type CsvImportResult } from '@/lib/actions/setup';
import { refreshLsqExclusions, LSQ_EXCLUSION_LIST_LIMIT } from '@/lib/lsqExclusions';

// Large LeadSquared lists against the fake LeadSquared server. The fake enforces the documented limit of
// 25 calls per 5 seconds (scaled here to 25 per 500 ms, with the app's own pacing scaled the same way), and
// can simulate the things the public docs leave open: a server-side cap on page size, on paging depth, and a
// RecordCount that means "this page" rather than "the list".

let fake: FakeLsq;
const made: string[] = [];
const realGap = process.env.LSQ_MIN_GAP_MS;

async function startFake(listPaging?: Parameters<typeof startFakeLsq>[0] extends infer O ? (O extends { listPaging?: infer L } ? L : never) : never) {
  if (fake) await fake.stop();
  fake = await startFakeLsq({ rateLimit: { limit: 25, windowMs: 500 }, listPaging });
  process.env.LSQ_API_BASE_URL = fake.url;
}

beforeAll(() => {
  process.env.LSQ_ACCESS_KEY = 'k';
  process.env.LSQ_SECRET_KEY = 's';
  process.env.LSQ_HOST = 'api.example.com';
  process.env.LSQ_MIN_GAP_MS = '22'; // the production 220 ms, scaled with the fake's window
});
beforeEach(async () => {
  await startFake();
});
afterEach(() => {
  delete process.env.LSQ_IMPORT_SLICE_MS;
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  await fake?.stop();
  if (realGap === undefined) delete process.env.LSQ_MIN_GAP_MS;
  else process.env.LSQ_MIN_GAP_MS = realGap;
});

function seed(n: number, name = 'Big list') {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(fake.seedLead({ EmailAddress: `lead${i}@big.example`, FirstName: `Lead${i}`, LastName: 'Test', Company: `Co${i % 50}`, JobTitle: 'Director' }).id);
  return fake.seedList(name, ids);
}
async function newCampaign() {
  const c = await db.campaign.create({ data: { name: 'Large list', vertical: 'x', date: 'x' } });
  made.push(c.id);
  return c.id;
}
/** What the Fetch Contacts button does: call again with the cursor until the import says it is done. */
async function importAll(campaignId: string, listId: string): Promise<{ res: CsvImportResult; calls: number }> {
  let calls = 1;
  let res = await importFromLsqListAction(campaignId, listId, 'Big list');
  while (res.ok && res.done === false && res.cursor) {
    calls++;
    res = await importFromLsqListAction(campaignId, listId, 'Big list', res.cursor);
    if (calls > 200) throw new Error('import never finished');
  }
  return { res, calls };
}
const stored = (id: string) => db.contact.count({ where: { campaignId: id } });

it('imports a 6,000-lead list in full (it used to stop silently at 2,000) without ever being throttled', async () => {
  const list = seed(6000);
  const id = await newCampaign();
  const { res } = await importAll(id, list.id);
  expect(res).toMatchObject({ ok: true, done: true, rowCount: 6000 });
  expect(res.warning).toBeUndefined();
  expect(await stored(id)).toBe(6000);
  expect(fake.state.throttled).toBe(0);
  expect((await db.campaign.findUniqueOrThrow({ where: { id } })).lsqListId).toBe(list.id);
}, 120_000);

it('imports a 25,000-lead list across slices and every lead arrives once', async () => {
  const list = seed(25_000);
  const id = await newCampaign();
  process.env.LSQ_IMPORT_SLICE_MS = '300'; // force several slices
  const { res, calls } = await importAll(id, list.id);
  expect(calls).toBeGreaterThan(1);
  expect(res).toMatchObject({ ok: true, done: true, rowCount: 25_000 });
  expect(await stored(id)).toBe(25_000);
  expect(await db.contact.count({ where: { campaignId: id, email: { in: ['lead0@big.example', 'lead12345@big.example', 'lead24999@big.example'] } } })).toBe(3);
  expect(fake.state.throttled).toBe(0);
}, 280_000);

it('does not re-add imported leads to the list they came from', async () => {
  const list = seed(1200);
  const id = await newCampaign();
  await importAll(id, list.id);
  expect(fake.requestsTo('AddLeadsToStaticList')).toHaveLength(0);
  expect(fake.requestsTo('Bulk/CreateOrUpdate')).toHaveLength(0);
}, 60_000);

it('creates and adds only the contacts that were not LeadSquared leads yet', async () => {
  const list = seed(100);
  const id = await newCampaign();
  await db.contact.create({ data: { campaignId: id, name: 'From A CSV', email: 'csv.person@elsewhere.example', account: 'Elsewhere', vertical: 'x', title: 'VP', function: 'x', seniority: 'x' } });
  const { res } = await importAll(id, list.id);
  expect(res.ok).toBe(true);
  const adds = fake.requestsTo('AddLeadsToStaticList');
  expect(adds).toHaveLength(1);
  expect((adds[0].body as { leadIds: string[] }).leadIds).toHaveLength(1);
  expect(fake.state.lists.get(list.id)!.members).toHaveLength(101);
  expect((await db.contact.findFirstOrThrow({ where: { campaignId: id, email: 'csv.person@elsewhere.example' } })).lsqLeadId).toBeTruthy();
}, 60_000);

it('importing the same list again updates contacts instead of duplicating them', async () => {
  const list = seed(700);
  const id = await newCampaign();
  await importAll(id, list.id);
  await importAll(id, list.id);
  expect(await stored(id)).toBe(700);
}, 60_000);

it('follows the page size the server really uses when it quietly gives fewer leads than asked for', async () => {
  await startFake({ maxPageSize: 200 });
  const list = seed(3000);
  const id = await newCampaign();
  const { res } = await importAll(id, list.id);
  expect(res).toMatchObject({ ok: true, rowCount: 3000 });
  expect(await stored(id)).toBe(3000);
}, 60_000);

it('halves the page size when LeadSquared times out on a large page', async () => {
  await startFake({ maxPageSizeBeforeTimeout: 300 });
  const list = seed(2500);
  const id = await newCampaign();
  const { res } = await importAll(id, list.id);
  expect(res).toMatchObject({ ok: true, rowCount: 2500 });
  expect(await stored(id)).toBe(2500);
}, 60_000);

it('works when RecordCount is the size of the page rather than of the list', async () => {
  await startFake({ recordCountIsPageCount: true });
  const list = seed(4200);
  const id = await newCampaign();
  const { res } = await importAll(id, list.id);
  expect(res).toMatchObject({ ok: true, rowCount: 4200 });
  expect(await stored(id)).toBe(4200);
}, 60_000);

it('reads a list from both ends when LeadSquared stops paging at 5,000, and says so when that is still not enough', async () => {
  await startFake({ maxDepth: 5000, deep: 'empty', honorSorting: true });
  const reachable = seed(8000, 'Eight thousand');
  const id1 = await newCampaign();
  const a = await importAll(id1, reachable.id);
  expect(a.res).toMatchObject({ ok: true, rowCount: 8000 });
  expect(a.res.warning).toBeUndefined();
  expect(await stored(id1)).toBe(8000);

  const tooBig = seed(12_000, 'Twelve thousand');
  const id2 = await newCampaign();
  const b = await importAll(id2, tooBig.id);
  expect(b.res.ok).toBe(true);
  expect(b.res.rowCount).toBe(10_000);
  expect(b.res.warning).toMatch(/10,000 of the 12,000 leads/);
  expect(b.res.warning).toMatch(/split the list/i);
  expect(await stored(id2)).toBe(10_000);
}, 120_000);

it('copes with a server that answers an error (not an empty page) beyond its paging depth', async () => {
  await startFake({ maxDepth: 3000, deep: 'error', honorSorting: true });
  const list = seed(3500);
  const id = await newCampaign();
  const { res } = await importAll(id, list.id);
  expect(res).toMatchObject({ ok: true, rowCount: 3500 });
  expect(await stored(id)).toBe(3500);
}, 120_000);

it('fails clearly, and keeps nothing half-written, when LeadSquared rejects the credentials', async () => {
  await startFake();
  const list = seed(300);
  const id = await newCampaign();
  fake.setFault({ match: 'Retrieve/BySearchParameter', status: 401, body: { ExceptionType: 'MXAuthenticationException', ExceptionMessage: 'Invalid keys' }, times: 'forever' });
  const res = await importFromLsqListAction(id, list.id, 'Big list');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/401/);
  expect(await stored(id)).toBe(0);
}, 60_000);

it('reads an exclusion list of 12,000 members, and refuses one over the limit instead of using a partial list', async () => {
  const list = seed(12_000, 'Exclude');
  const id = await newCampaign();
  await db.campaign.update({ where: { id }, data: { lsqExclusionListIds: JSON.stringify([list.id]) } });
  expect(await refreshLsqExclusions(id, true)).toBe(12_000);
  expect(fake.state.throttled).toBe(0);

  const huge = fake.seedList('Too big', Array.from({ length: LSQ_EXCLUSION_LIST_LIMIT + 1 }, (_, i) => fake.seedLead({ EmailAddress: `x${i}@huge.example` }).id));
  await db.campaign.update({ where: { id }, data: { lsqExclusionListIds: JSON.stringify([huge.id]) } });
  await expect(refreshLsqExclusions(id, true)).rejects.toThrow(/exceeds the 25,000-member limit/);
}, 280_000);
