import { it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/claude', async (orig) => ({ ...(await orig<typeof import('@/lib/claude')>()), enrichContacts: vi.fn(async () => ({ results: [], failedBatches: 0 })) }));
import { db } from '@/lib/db';
import { startFakeApollo, type FakeApollo } from '../fakes/apolloFake';
import { runEnrichment } from '@/lib/enrichment';
import { queueAudienceJob, processAudienceJob, advanceAudienceJob, processAudienceJobs } from '@/lib/audienceJobs';
import { resolveRecipient } from '@/lib/sendGuard';

// Apollo enrichment against a fake that follows Apollo's documented API (bulk_match of 10, rate limits with
// retry-after, phones under person.contact, placeholder emails for locked records, 401/403/422).

let fake: FakeApollo;
const made: string[] = [];
beforeAll(async () => {
  fake = await startFakeApollo();
  process.env.APOLLO_API_BASE_URL = fake.apiUrl;
  process.env.APOLLO_API_KEY = 'test-key';
});
beforeEach(() => fake.reset());
afterEach(() => {
  process.env.APOLLO_API_KEY = 'test-key';
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  await fake.stop();
});

const fields = { claudePersona: false };
async function campaign() {
  const c = await db.campaign.create({ data: { name: 'Apollo', vertical: 'x', date: 'x' } });
  made.push(c.id);
  return c.id;
}
let n = 0;
async function contact(campaignId: string, o: Partial<{ first: string; last: string; email: string | null; title: string; account: string; phone: string | null; linkedinId: string }> = {}) {
  const i = n++;
  const first = o.first ?? `First${i}`;
  const last = o.last ?? `Last${i}`;
  return db.contact.create({
    data: { campaignId, name: `${first} ${last}`, email: o.email === undefined ? `${first}.${last}@acme.com`.toLowerCase() : o.email, account: o.account ?? 'Acme', vertical: 'x', title: o.title ?? 'Director', function: 'x', seniority: 'x', phone: o.phone ?? null, linkedinId: o.linkedinId ?? null },
  });
}
const get = (id: string) => db.contact.findUniqueOrThrow({ where: { id } });

it('does not ask Apollo about contacts that only lack a phone number', async () => {
  const id = await campaign();
  for (let i = 0; i < 25; i++) await contact(id); // email and title present, no phone
  const r = await runEnrichment(id, { fields });
  expect(r.ok).toBe(true);
  expect(fake.requests).toHaveLength(0);
});

it('looks people up ten at a time, fills in email and title, and uses the company domain colleagues reveal', async () => {
  const id = await campaign();
  await contact(id, { first: 'Known', last: 'Colleague', email: 'known.colleague@acme-corp.io', account: 'Acme' });
  const ids: string[] = [];
  for (let i = 0; i < 23; i++) {
    const c = await contact(id, { first: `Want${i}`, last: `Email${i}`, email: null, title: '—' });
    ids.push(c.id);
    fake.seed({ first_name: `Want${i}`, last_name: `Email${i}`, organization: 'Acme Corporation', domain: 'acme-corp.io', title: 'VP Sales', email: `want${i}@acme-corp.io`, linkedin_url: `https://linkedin.com/in/want${i}` });
  }
  const r = await runEnrichment(id, { fields });
  expect(r).toMatchObject({ ok: true, emailsFoundReal: 23, titlesUpdated: 23, emailsInferred: 0 });
  expect(fake.requests.filter((q) => q.path.endsWith('/bulk_match'))).toHaveLength(3); // 10 + 10 + 3
  // The learned domain travelled with each lookup (a company NAME of "Acme" alone would not have matched "Acme Corporation").
  const sent = (fake.requests[0].body as { details: Array<Record<string, string>> }).details;
  expect(sent.every((d) => d.domain === 'acme-corp.io')).toBe(true);
  const c0 = await get(ids[0]);
  expect(c0).toMatchObject({ email: 'want0@acme-corp.io', title: 'VP Sales', emailVerified: true, emailSimulated: false, linkedinId: 'https://linkedin.com/in/want0' });
  expect(() => resolveRecipient(c0)).not.toThrow();
});

it('saves a phone number when Apollo returns one (it lives under person.contact)', async () => {
  const id = await campaign();
  const c = await contact(id, { email: null });
  fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: 'found@acme.com', phone_numbers: [{ raw_number: '+1 (555) 010-0100', sanitized_number: '+15550100100' }] });
  const r = await runEnrichment(id, { fields });
  expect(r.phonesFound).toBe(1);
  expect((await get(c.id)).phone).toBe('+15550100100');
});

it('never stores Apollo\'s "email not unlocked" placeholder as an email', async () => {
  const id = await campaign();
  const c = await contact(id, { email: null, title: '—' });
  fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', locked: true, domain: 'acme.com', title: 'CFO' });
  const r = await runEnrichment(id, { fields });
  const after = await get(c.id);
  expect(after.email ?? '').not.toMatch(/email_not_unlocked/);
  expect(after.email).toBeNull();
  expect(r.emailsFoundReal).toBe(0);
  expect(after.title).toBe('CFO'); // the rest of what Apollo returned is still used
});

it('holds a real email that Apollo does not call verified until a person approves it', async () => {
  const id = await campaign();
  const c = await contact(id, { email: null });
  fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: 'maybe@acme.com', email_status: 'likely_to_engage' });
  const r = await runEnrichment(id, { fields });
  expect(r).toMatchObject({ emailsFoundReal: 1, emailsUnverified: 1 });
  const after = await get(c.id);
  expect(after.email).toBe('maybe@acme.com');
  expect(() => resolveRecipient(after)).toThrow(/verify it before sending/);
});

it('does not assign a result to the wrong person when matches come back in a different order', async () => {
  fake.setOptions({ shuffleBulk: true });
  const id = await campaign();
  const people = [] as { id: string; first: string }[];
  for (let i = 0; i < 6; i++) {
    const c = await contact(id, { first: `Person${i}`, last: `Surname${i}`, email: null });
    people.push({ id: c.id, first: `Person${i}` });
    fake.seed({ first_name: `Person${i}`, last_name: `Surname${i}`, organization: 'Acme', email: `person${i}@acme.com` });
  }
  const r = await runEnrichment(id, { fields });
  expect(r.emailsFoundReal).toBe(6);
  for (const p of people) expect((await get(p.id)).email).toBe(`${p.first.toLowerCase()}@acme.com`);
});

it('waits out a short rate limit and carries on, instead of treating the rest as "no match"', async () => {
  fake.setOptions({ perMinute: 2, windowMs: 1500 }); // two requests per 1.5 s; Apollo's retry-after says how long
  const id = await campaign();
  for (let i = 0; i < 45; i++) {
    const c = await contact(id, { email: null });
    fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: `r${i}@acme.com` });
  }
  const r = await runEnrichment(id, { fields });
  expect(fake.throttled).toBeGreaterThan(0);
  expect(r).toMatchObject({ ok: true, emailsFoundReal: 45, apolloDeferred: 0 });
}, 60_000);

it('a long rate limit leaves the rest untouched (not guessed, not marked enriched) and says when to retry', async () => {
  fake.setOptions({ total: 2, retryAfterSec: 3600 });
  const id = await campaign();
  const ids: string[] = [];
  for (let i = 0; i < 45; i++) {
    const c = await contact(id, { email: null });
    ids.push(c.id);
    fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: `r${i}@acme.com` });
  }
  const r = await runEnrichment(id, { fields });
  expect(r.apolloDeferred).toBe(25); // two requests of ten answered, then limited: five-and-twenty waiting
  expect(r.apolloRetryAfterSec).toBe(3600);
  expect(r.apolloApiError).toMatch(/rate limit/i);
  expect(r.emailsFoundReal).toBe(20);
  expect(r.emailsInferred).toBe(0);
  const untouched = await get(ids[44]);
  expect(untouched.email).toBeNull();
  expect(untouched.enrichedAt).toBeNull();
  const done = await get(ids[0]);
  expect(done.email).toBe('r0@acme.com');
  expect(await db.attentionItem.count({ where: { campaignId: id, title: 'Apollo enrichment is waiting' } })).toBe(1);
});

it('reports a rejected key and a key without enrichment access distinctly, and stops', async () => {
  const id = await campaign();
  const c = await contact(id, { email: null });
  fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: 'x@acme.com' });

  process.env.APOLLO_API_KEY = 'wrong-key';
  const bad = await runEnrichment(id, { fields });
  expect(bad.apolloFatal).toBe(true);
  expect(bad.apolloApiError).toMatch(/rejected the API key \(HTTP 401\)/);

  fake.setOptions({ forbiddenKeys: ['plan-key'] });
  process.env.APOLLO_API_KEY = 'plan-key';
  const forbidden = await runEnrichment(id, { fields });
  expect(forbidden.apolloFatal).toBe(true);
  expect(forbidden.apolloApiError).toMatch(/HTTP 403/);
  expect(forbidden.apolloApiError).toMatch(/master API key/);
  expect((await get(c.id)).email).toBeNull(); // not guessed either
});

it('without an Apollo key it infers only from a domain seen on a colleague, and never invents one', async () => {
  delete process.env.APOLLO_API_KEY;
  const id = await campaign();
  await contact(id, { first: 'Real', last: 'Colleague', email: 'real.colleague@globex.com', account: 'Globex' });
  const withDomain = await contact(id, { first: 'Ann', last: 'Smith', email: null, account: 'Globex' });
  const noDomain = await contact(id, { first: 'Bob', last: 'Jones', email: null, account: 'Initech' });
  const r = await runEnrichment(id, { fields });
  expect((await get(withDomain.id)).email).toBe('ann.smith@globex.com');
  expect((await get(noDomain.id)).email).toBeNull();
  expect(r).toMatchObject({ emailsInferred: 1, couldNotEnrich: 1 });
  expect(fake.requests).toHaveLength(0);
});

it('a rate-limited audience job stops with its cursor where it was, and finishes when retried', async () => {
  fake.setOptions({ total: 1, retryAfterSec: 3600 });
  const id = await campaign();
  for (let i = 0; i < 12; i++) {
    const c = await contact(id, { email: null });
    fake.seed({ first_name: c.name.split(' ')[0], last_name: c.name.split(' ')[1], organization: 'Acme', email: `j${i}@acme.com` });
  }
  const first = await queueAudienceJob(id, 'enrichment', { fields });
  expect(first.ok).toBe(true); // the first batch of ten fits in the one request Apollo allows
  const job = await db.operationJob.findFirstOrThrow({ where: { campaignId: id, kind: 'enrichment' } });
  const second = await processAudienceJob(job.id);
  expect(second.ok).toBe(false);
  expect(second.error).toMatch(/rate limit/i);
  const stopped = await db.operationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stopped.status).toBe('failed');
  expect(stopped.cursor).toBe(10); // stopped after the first batch, not marching on through the rest

  fake.setOptions({ total: undefined });
  await db.operationJob.update({ where: { id: job.id }, data: { status: 'pending' } });
  let guard = 0;
  let last = await processAudienceJob(job.id);
  while (last.ok && (last.queuedCount ?? 0) > 0 && guard++ < 10) last = await processAudienceJob(job.id);
  const finished = await db.operationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect({ status: finished.status, error: (finished.error ?? '').replace(/\s+/g, ' ').slice(-400), cursor: finished.cursor, total: finished.total }).toEqual({ status: 'completed', error: '', cursor: 12, total: 12 });
  expect(await db.contact.count({ where: { campaignId: id, email: { not: null } } })).toBe(12);
});

it('enriches 600 contacts with 60 requests, not 600, riding out a 50-a-minute limit', async () => {
  fake.setOptions({ perMinute: 50, windowMs: 1000 }); // Apollo's 50 a minute, scaled to a second
  const id = await campaign();
  const data = Array.from({ length: 600 }, (_, i) => ({ campaignId: id, name: `Bulk${i} Person${i}`, email: null as string | null, account: 'Acme', vertical: 'x', title: 'Director', function: 'x', seniority: 'x' }));
  await db.contact.createMany({ data });
  for (let i = 0; i < 600; i++) fake.seed({ first_name: `Bulk${i}`, last_name: `Person${i}`, organization: 'Acme', email: `bulk${i}@acme.com` });
  const r = await runEnrichment(id, { fields });
  expect(r).toMatchObject({ ok: true, emailsFoundReal: 600, apolloDeferred: 0 });
  expect(fake.requests.filter((q) => q.status === 200)).toHaveLength(60);
}, 120_000);

it('one address clash does not fail the batch: the contact keeps everything else and the run says so', async () => {
  const id = await campaign();
  const holder = await contact(id, { first: 'Held', last: 'Already', email: 'taken@acme.com' });
  const twin = await contact(id, { first: 'Twin', last: 'Person', email: null, title: '—' });
  const other = await contact(id, { first: 'Other', last: 'Person', email: null, title: '—' });
  fake.seed({ first_name: 'Twin', last_name: 'Person', organization: 'Acme', email: 'taken@acme.com', title: 'COO' }); // already someone else's
  fake.seed({ first_name: 'Other', last_name: 'Person', organization: 'Acme', email: 'other@acme.com', title: 'CTO' });
  const r = await runEnrichment(id, { fields });
  expect(r.ok).toBe(true);
  expect((await get(holder.id)).email).toBe('taken@acme.com');
  const t = await get(twin.id);
  expect(t.email).toBeNull();
  expect(t.title).toBe('COO');
  expect(await get(other.id)).toMatchObject({ email: 'other@acme.com', title: 'CTO' });
  expect(await db.activityLogEntry.count({ where: { campaignId: id, text: { contains: 'already held by another contact' } } })).toBe(1);
});

it('two contacts with the same name and no email do not collide on an inferred address', async () => {
  delete process.env.APOLLO_API_KEY;
  const id = await campaign();
  await contact(id, { first: 'Real', last: 'Colleague', email: 'real.colleague@globex.com', account: 'Globex' });
  const a = await contact(id, { first: 'Ann', last: 'Smith', email: null, account: 'Globex' });
  const b = await contact(id, { first: 'Ann', last: 'Smith', email: null, account: 'Globex' });
  const r = await runEnrichment(id, { fields });
  expect(r.ok).toBe(true);
  const emails = [(await get(a.id)).email, (await get(b.id)).email].filter(Boolean);
  expect(emails).toEqual(['ann.smith@globex.com']); // one gets it, the other is left without rather than failing the run
});


// --- A paid plan: Apollo allows 1,000 enrichment requests a minute and no hourly or daily cap -------------------

async function seedAudience(campaignId: string, count: number) {
  await db.contact.createMany({ data: Array.from({ length: count }, (_, i) => ({ campaignId, name: `Paid${i} Plan${i}`, email: null as string | null, account: 'Acme', vertical: 'x', title: 'Director', function: 'x', seniority: 'x' })) });
  for (let i = 0; i < count; i++) fake.seed({ first_name: `Paid${i}`, last_name: `Plan${i}`, organization: 'Acme', email: `paid${i}@acme.com`, title: 'Head of Growth' });
}

it('paid plan: one run through the job enriches the WHOLE audience, not just the first batch', async () => {
  fake.setOptions({ perMinute: 1000 });
  const id = await campaign();
  await seedAudience(id, 1500);
  const first = await queueAudienceJob(id, 'enrichment', { fields });
  // The first call alone only handles one batch...
  expect(first.completedCount).toBe(10);
  expect(first.queuedCount).toBe(1490);
  expect(await db.contact.count({ where: { campaignId: id, email: { not: null } } })).toBe(10);
  // ...and the browser carries on (in slices of about 40 seconds of server work each) until it is done.
  let step = first as Awaited<ReturnType<typeof advanceAudienceJob>>;
  let slices = 0;
  while (step.ok && (step.queuedCount ?? 0) > 0 && slices++ < 20) step = await advanceAudienceJob(step.jobId!, 40_000);
  expect(step).toMatchObject({ ok: true, queuedCount: 0, completedCount: 1500 });
  expect(await db.contact.count({ where: { campaignId: id, email: { not: null } } })).toBe(1500);
  expect(fake.requests.filter((q) => q.status === 200)).toHaveLength(150); // ten people per request
  expect(fake.throttled).toBe(0);
  // The result describes the whole job, not just its last batch.
  expect(step).toMatchObject({ emailsFoundReal: 1500, titlesUpdated: 0 });
  expect((await db.operationJob.findFirstOrThrow({ where: { campaignId: id, kind: 'enrichment' } })).status).toBe('completed');
}, 120_000);

it('paid plan: a slice stops at its time budget and says how much is left', async () => {
  fake.setOptions({ perMinute: 1000, latencyMs: 60 });
  const id = await campaign();
  await seedAudience(id, 400);
  const first = await queueAudienceJob(id, 'enrichment', { fields });
  const slice = await advanceAudienceJob(first.jobId!, 300); // about five batches' worth of time
  expect(slice.ok).toBe(true);
  expect(slice.queuedCount).toBeGreaterThan(0);
  expect(slice.completedCount).toBeGreaterThan(10);
  expect(slice.completedCount! + slice.queuedCount!).toBe(400);
  fake.setOptions({ latencyMs: 0 });
  const done = await advanceAudienceJob(first.jobId!, 40_000);
  expect(done).toMatchObject({ ok: true, queuedCount: 0, completedCount: 400 });
}, 60_000);

it('paid plan: the background worker also carries a queued job through to the end in one tick', async () => {
  fake.setOptions({ perMinute: 1000 });
  const id = await campaign();
  await seedAudience(id, 300);
  const first = await queueAudienceJob(id, 'enrichment', { fields });
  expect(first.queuedCount).toBe(290);
  await processAudienceJobs(30_000);
  expect(await db.contact.count({ where: { campaignId: id, email: { not: null } } })).toBe(300);
  expect((await db.operationJob.findFirstOrThrow({ where: { campaignId: id, kind: 'enrichment' } })).status).toBe('completed');
}, 60_000);

it('paid plan: 5,000 contacts with some already complete, some unknown to Apollo and some clashing', async () => {
  fake.setOptions({ perMinute: 1000 });
  const id = await campaign();
  const rows = Array.from({ length: 5000 }, (_, i) => ({
    campaignId: id,
    name: `Mixed${i} Audience${i}`,
    // every fifth already has an email (and is never sent to Apollo), every seventh is unknown to Apollo
    email: i % 5 === 0 ? `have${i}@acme.com` : (null as string | null),
    account: 'Acme', vertical: 'x', title: 'Director', function: 'x', seniority: 'x',
  }));
  await db.contact.createMany({ data: rows });
  for (let i = 0; i < 5000; i++) if (i % 5 !== 0 && i % 7 !== 0) fake.seed({ first_name: `Mixed${i}`, last_name: `Audience${i}`, organization: 'Acme', email: `mixed${i}@acme.com` });
  const first = await queueAudienceJob(id, 'enrichment', { fields });
  let step = first as Awaited<ReturnType<typeof advanceAudienceJob>>;
  let slices = 0;
  while (step.ok && (step.queuedCount ?? 0) > 0 && slices++ < 30) step = await advanceAudienceJob(step.jobId!, 40_000);
  expect(step).toMatchObject({ ok: true, queuedCount: 0 });
  const wanted = Array.from({ length: 5000 }, (_, i) => i).filter((i) => i % 5 !== 0);
  const found = wanted.filter((i) => i % 7 !== 0).length;
  // (The contacts Apollo does not know get an address inferred from the company domain; with identical-looking
  // names only the first can have it, and the rest are left empty instead of failing the job.)
  expect(await db.contact.count({ where: { campaignId: id, email: { startsWith: 'mixed' }, NOT: { email: { startsWith: 'mixed.' } } } })).toBe(found);
  // Everyone except the already-complete fifth was looked up; nobody was looked up twice.
  const lookedUp = fake.requests.filter((q) => q.status === 200).reduce((n, q) => n + ((q.body as { details: unknown[] }).details?.length ?? 0), 0);
  expect(lookedUp).toBe(wanted.length);
  expect(fake.throttled).toBe(0);
}, 280_000);
