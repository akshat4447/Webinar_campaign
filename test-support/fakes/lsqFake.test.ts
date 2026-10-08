import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// lib/leadsquared.ts resolves credentials through the DB-backed integration config;
// replace it with fixed values. `h.config` is mutable so a test can change the sender.
const h = vi.hoisted(() => ({
  config: { accessKey: 'AK', secretKey: 'SK', host: 'api-in21.leadsquared.com', senderEmail: 'sender@example.com' as string | undefined } as Record<string, string | undefined>,
}));
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => h.config[key]),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

import { sleep } from '@/lib/retry';
import {
  addLeadsToStaticList,
  bulkCreateOrUpdateLeads,
  createActivityType,
  createEmptyList,
  createOrUpdateLead,
  emptyStaticList,
  getActivityTypeDetails,
  getLeadByEmailAddress,
  getLeadById,
  getLeadsInList,
  getLeadsMetadata,
  getLists,
  LeadSquaredError,
  listActivityTypes,
  listUsers,
  PartialActivityPushError,
  probeSenderIdentity,
  pushCustomActivities,
  registerLeadSquaredWebhook,
  resetLeadSchemaCache,
  sendEmailToLead,
  setLeadSchemaOverrideForTests,
} from '@/lib/leadsquared';
import { startFakeLsq, type FakeLsq } from './lsqFake';

type Json = Record<string, unknown>;

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  /** Parsed body (undefined if not JSON). */
  json: unknown;
  obj: Json;
  arr: Json[];
}

let fake: FakeLsq;
const originalBase = process.env.LSQ_API_BASE_URL;

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; rawBody?: string; auth?: boolean; base?: string; signal?: AbortSignal } = {}
): Promise<Reply> {
  const params = new URLSearchParams(opts.query ?? {});
  if (opts.auth !== false) {
    params.set('accessKey', 'AK');
    params.set('secretKey', 'SK');
  }
  const qs = params.toString();
  const res = await fetch(`${opts.base ?? fake.url}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: opts.body !== undefined || opts.rawBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json, obj: (json ?? {}) as Json, arr: (Array.isArray(json) ? json : []) as Json[] };
}

const attrs = (o: Record<string, string>, searchBy?: string): Array<{ Attribute: string; Value: string }> => [
  ...Object.entries(o).map(([Attribute, Value]) => ({ Attribute, Value })),
  ...(searchBy ? [{ Attribute: 'SearchBy', Value: searchBy }] : []),
];
const L = '/LeadManagement.svc';
const upsert = (o: Record<string, string>, searchBy?: string): Promise<Reply> => call('POST', `${L}/Lead.CreateOrUpdate`, { query: { postUpdatedLead: 'true' }, body: attrs(o, searchBy) });

beforeAll(async () => {
  fake = await startFakeLsq();
  process.env.LSQ_API_BASE_URL = fake.url;
});
afterAll(async () => {
  await fake.stop();
  if (originalBase === undefined) delete process.env.LSQ_API_BASE_URL;
  else process.env.LSQ_API_BASE_URL = originalBase;
});
beforeEach(() => {
  fake.reset();
  resetLeadSchemaCache();
  // These contract tests exercise the raw client (including the tenant's own rejection of unknown
  // attributes). Schema discovery has its own suite: test-support/integration/lsqFieldDiscovery.
  setLeadSchemaOverrideForTests(null);
  h.config.senderEmail = 'sender@example.com';
  vi.mocked(sleep).mockClear();
});
afterEach(() => {
  fake.clearFaults();
});

// ===========================================================================
// RAW HTTP BEHAVIOUR
// ===========================================================================

describe('server basics', () => {
  it('uses an ephemeral port and a /v2 base url', () => {
    expect(fake.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v2$/);
    expect(fake.port).toBeGreaterThan(0);
  });

  it('answers 401 with an LSQ-like JSON error for missing credentials', async () => {
    const r = await call('GET', `${L}/Lists.Get`, { auth: false });
    expect(r.status).toBe(401);
    expect(r.obj).toMatchObject({ Status: 'Error', ExceptionType: expect.stringMatching(/^MX/) as unknown as string });
    expect(typeof r.obj.ExceptionMessage).toBe('string');
  });

  it('answers 401 for wrong credentials when the fake is configured with specific keys', async () => {
    const strict = await startFakeLsq({ accessKey: 'right-ak', secretKey: 'right-sk' });
    try {
      const bad = await call('GET', `${L}/Lists.Get`, { base: strict.url });
      expect(bad.status).toBe(401);
      const good = await fetch(`${strict.url}${L}/Lists.Get?accessKey=right-ak&secretKey=right-sk`);
      expect(good.status).toBe(200);
      const halfRight = await fetch(`${strict.url}${L}/Lists.Get?accessKey=right-ak&secretKey=nope`);
      expect(halfRight.status).toBe(401);
    } finally {
      await strict.stop();
    }
  });

  it('answers 404 for unknown endpoints and paths outside /v2, 405 for the wrong method, 400 for bad JSON', async () => {
    expect((await call('GET', '/Nope.svc/Thing')).status).toBe(404);
    const outside = await fetch(`${fake.url.replace('/v2', '')}/LeadManagement.svc/Lists.Get?accessKey=a&secretKey=b`);
    expect(outside.status).toBe(404);
    expect((await call('POST', `${L}/Lists.Get`, { body: {} })).status).toBe(405);
    expect((await call('GET', `${L}/Lead.CreateOrUpdate`)).status).toBe(405);
    const bad = await call('POST', `${L}/Lead.CreateOrUpdate`, { rawBody: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('logs every request (credentials stripped) with method, path, query, body and timestamp', async () => {
    const before = Date.now();
    await upsert({ EmailAddress: 'log@x.com' });
    const entry = fake.state.requestLog.at(-1);
    expect(entry).toMatchObject({ method: 'POST', path: `${L}/Lead.CreateOrUpdate`, query: { postUpdatedLead: 'true' }, status: 200 });
    expect(entry?.body).toEqual([
      { Attribute: 'EmailAddress', Value: 'log@x.com' },
    ]);
    expect(entry?.ts).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(entry)).not.toContain('secretKey');
  });
});

describe('LeadsMetaData.Get', () => {
  it('returns standard fields and, by default, none of the app custom fields', async () => {
    const r = await call('GET', `${L}/LeadsMetaData.Get`);
    expect(r.status).toBe(200);
    const names = r.arr.map((f) => f.SchemaName);
    expect(names).toEqual(expect.arrayContaining(['EmailAddress', 'FirstName', 'LastName', 'Company', 'JobTitle', 'Phone', 'Mobile', 'ProspectID']));
    expect(names).not.toContain('mx_Webinar_ICP_Score');
    expect(names).not.toContain('mx_Seniority');
    expect(names).not.toContain('mx_Function');
    for (const f of r.arr) expect(Object.keys(f).sort()).toEqual(['DataType', 'DisplayName', 'SchemaName']);
  });

  it('includes customFields passed at start-up (and via state.config)', async () => {
    const custom = await startFakeLsq({ customFields: ['mx_Seniority'] });
    try {
      const r = await call('GET', `${L}/LeadsMetaData.Get`, { base: custom.url });
      expect(r.arr.map((f) => f.SchemaName)).toContain('mx_Seniority');
    } finally {
      await custom.stop();
    }
    fake.state.config.customFields.push('mx_Function');
    expect((await call('GET', `${L}/LeadsMetaData.Get`)).arr.map((f) => f.SchemaName)).toContain('mx_Function');
  });
});

describe('Lead.CreateOrUpdate', () => {
  it('creates, then updates in place (same Id), returning {Status, Message:{Id, AffectedRows}}', async () => {
    const created = await upsert({ EmailAddress: 'Ann@Example.com', FirstName: 'Ann' });
    expect(created.status).toBe(200);
    expect(created.obj.Status).toBe('Success');
    const msg = created.obj.Message as Json;
    expect(typeof msg.Id).toBe('string');
    expect(msg.AffectedRows).toBe(1);

    const updated = await upsert({ EmailAddress: 'ann@example.com', LastName: 'Lee' });
    expect((updated.obj.Message as Json).Id).toBe(msg.Id);
    expect(fake.state.leads.size).toBe(1);
    const lead = fake.state.leads.get(String(msg.Id));
    expect(lead?.fields).toMatchObject({ EmailAddress: 'ann@example.com', FirstName: 'Ann', LastName: 'Lee' });
    expect(fake.state.leadsByEmail.get('ann@example.com')).toBe(lead);
  });

  it('honours SearchBy (default EmailAddress; Phone and ProspectID supported)', async () => {
    const a = await upsert({ EmailAddress: 'p@x.com', Phone: '+911111' });
    const byPhone = await upsert({ Phone: '+911111', FirstName: 'Pat' }, 'Phone');
    expect((byPhone.obj.Message as Json).Id).toBe((a.obj.Message as Json).Id);
    expect(fake.state.leads.size).toBe(1);

    const byId = await upsert({ ProspectID: String((a.obj.Message as Json).Id), LastName: 'Q' }, 'ProspectID');
    expect(byId.status).toBe(200);
    expect(fake.state.leads.size).toBe(1);

    const missingId = await upsert({ ProspectID: 'no-such-lead', LastName: 'Q' }, 'ProspectID');
    expect(missingId.status).toBe(500);
    expect(missingId.obj.ExceptionType).toBe('MXInvalidInputException');
  });

  it('rejects an unknown attribute with HTTP 500 + MXUnknownAttributeException and writes nothing', async () => {
    const r = await upsert({ EmailAddress: 'u@x.com', mx_Webinar_ICP_Score: '80', mx_Seniority: 'VP' });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({
      ExceptionType: 'MXUnknownAttributeException',
      ExceptionMessage: 'Attribute(s) does not exist - mx_Webinar_ICP_Score, mx_Seniority.',
    });
    expect(fake.state.leads.size).toBe(0);
  });

  it('accepts an attribute once it is added to customFields', async () => {
    fake.state.config.customFields.push('mx_Seniority');
    expect((await upsert({ EmailAddress: 'k@x.com', mx_Seniority: 'VP' })).status).toBe(200);
    expect(fake.state.leadsByEmail.get('k@x.com')?.fields.mx_Seniority).toBe('VP');
  });

  it('rejects an invalid email, a missing SearchBy value and a colliding email change', async () => {
    const bad = await upsert({ EmailAddress: 'not-an-email' });
    expect(bad.status).toBe(500);
    expect(bad.obj.ExceptionType).toBe('MXInvalidInputException');

    const missing = await upsert({ FirstName: 'NoEmail' });
    expect(missing.status).toBe(500);
    expect(missing.obj.ExceptionType).toBe('MXMandatoryAttributeMissingException');

    await upsert({ EmailAddress: 'one@x.com', Phone: '1' });
    await upsert({ EmailAddress: 'two@x.com', Phone: '2' });
    const collide = await upsert({ Phone: '2', EmailAddress: 'one@x.com' }, 'Phone');
    expect(collide.status).toBe(500);
    expect(collide.obj.ExceptionType).toBe('MXDuplicateEntryException');
  });

  it('re-indexes the email map when a lead found by phone changes email', async () => {
    await upsert({ EmailAddress: 'old@x.com', Phone: '9' });
    await upsert({ Phone: '9', EmailAddress: 'new@x.com' }, 'Phone');
    expect(fake.state.leadsByEmail.has('old@x.com')).toBe(false);
    expect(fake.state.leadsByEmail.has('new@x.com')).toBe(true);
    expect(fake.state.leads.size).toBe(1);
  });
});

describe('Lead/Bulk/CreateOrUpdate', () => {
  const B = `${L}/Lead/Bulk/CreateOrUpdate`;
  const row = (email: string, extra: Record<string, string> = {}): Array<{ Attribute: string; Value: string }> => attrs({ EmailAddress: email, ...extra }, 'EmailAddress');

  it('returns one result per row with 1-based RowNumber, created/updated flags and inline failures', async () => {
    await upsert({ EmailAddress: 'exists@x.com' });
    const r = await call('POST', B, { body: [row('new@x.com'), row('exists@x.com'), row('bad@x.com', { mx_Nope: '1' }), row('not-an-email'), row('dup@x.com'), row('DUP@x.com')] });
    expect(r.status).toBe(200);
    expect(r.arr).toHaveLength(6);
    expect(r.arr.map((x) => x.RowNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.arr[0]).toMatchObject({ LeadCreated: true, LeadUpdated: false, AffectedRows: 1 });
    expect(r.arr[0].LeadId).toMatch(/\S/);
    expect(r.arr[1]).toMatchObject({ LeadCreated: false, LeadUpdated: true, AffectedRows: 1 });

    expect(r.arr[2]).toMatchObject({ LeadId: '', LeadCreated: false, LeadUpdated: false, AffectedRows: 0, ExceptionType: 'MXUnknownAttributeException' });
    expect(String(r.arr[2].ErrorMessage)).toContain('mx_Nope');
    expect(r.arr[3]).toMatchObject({ LeadId: '', ExceptionType: 'MXInvalidInputException' });
    // intra-call duplicate: second sighting is an update of the first
    expect(r.arr[4]).toMatchObject({ LeadCreated: true });
    expect(r.arr[5]).toMatchObject({ LeadUpdated: true, LeadId: r.arr[4].LeadId });
    expect(fake.state.leads.size).toBe(3); // exists, new, dup
  });

  it('answers 400 for more than 25 rows (and for an empty / non-array body), storing nothing', async () => {
    const many = Array.from({ length: 26 }, (_, i) => row(`m${i}@x.com`));
    expect((await call('POST', B, { body: many })).status).toBe(400);
    expect((await call('POST', B, { body: [] })).status).toBe(400);
    expect((await call('POST', B, { body: { a: 1 } })).status).toBe(400);
    expect(fake.state.leads.size).toBe(0);
    const exactly25 = await call('POST', B, { body: many.slice(0, 25) });
    expect(exactly25.status).toBe(200);
    expect(exactly25.arr).toHaveLength(25);
  });
});

describe('lead retrieval', () => {
  it('Leads.GetByEmailAddress returns a bare array of flat lead objects, [] when none (case-insensitive)', async () => {
    const lead = fake.seedLead({ EmailAddress: 'Find@X.com', FirstName: 'Fin', Company: 'Acme' });
    const r = await call('GET', `${L}/Leads.GetByEmailAddress`, { query: { emailaddress: 'find@x.com' } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.arr).toHaveLength(1);
    expect(r.arr[0]).toMatchObject({ ProspectID: lead.id, FirstName: 'Fin', Company: 'Acme', EmailAddress: 'Find@X.com' });
    expect((await call('GET', `${L}/Leads.GetByEmailAddress`, { query: { emailaddress: 'ghost@x.com' } })).json).toEqual([]);
    // the wrong parameter name (the real-world bug the client comment mentions) finds nothing / errors
    const wrongParam = await call('GET', `${L}/Leads.GetByEmailAddress`, { query: { email: 'find@x.com' } });
    expect(wrongParam.status).toBe(500);
  });

  it('Leads.GetById returns the lead, or [] for an unknown id', async () => {
    const lead = fake.seedLead({ EmailAddress: 'id@x.com' });
    const r = await call('GET', `${L}/Leads.GetById`, { query: { id: lead.id } });
    expect(r.arr[0]).toMatchObject({ ProspectID: lead.id, EmailAddress: 'id@x.com' });
    expect((await call('GET', `${L}/Leads.GetById`, { query: { id: 'nope' } })).json).toEqual([]);
  });

  it('Retrieve/BySearchParameter pages list members and honours Include_CSV', async () => {
    const leads = Array.from({ length: 5 }, (_, i) => fake.seedLead({ EmailAddress: `r${i}@x.com`, FirstName: `F${i}` }));
    const list = fake.seedList('Members', leads.map((l) => l.id));
    const page = (n: number, size: number): Promise<Reply> =>
      call('POST', `${L}/Leads/Retrieve/BySearchParameter`, {
        body: {
          SearchParameters: { ListId: list.id },
          Columns: { Include_CSV: 'ProspectID,EmailAddress,FirstName,Phone,mx_Unknown' },
          Paging: { PageIndex: n, PageSize: size },
        },
      });
    const p1 = await page(1, 2);
    expect(p1.obj.RecordCount).toBe(5);
    const props = (p1.obj.Leads as Array<{ LeadPropertyList: Array<{ Attribute: string; Value: unknown }> }>)[0].LeadPropertyList;
    expect(props.map((p) => p.Attribute)).toEqual(['ProspectID', 'EmailAddress', 'FirstName', 'Phone']); // mx_Unknown ignored
    expect(props.find((p) => p.Attribute === 'Phone')?.Value).toBeNull();
    expect((p1.obj.Leads as unknown[]).length).toBe(2);
    expect(((await page(3, 2)).obj.Leads as unknown[]).length).toBe(1);
    expect(((await page(4, 2)).obj.Leads as unknown[]).length).toBe(0);
    const unknownList = await call('POST', `${L}/Leads/Retrieve/BySearchParameter`, { body: { SearchParameters: { ListId: 'nope' }, Paging: { PageIndex: 1, PageSize: 10 } } });
    expect(unknownList.obj).toEqual({ RecordCount: 0, Leads: [] });
  });
});

describe('lists', () => {
  const S = '/LeadSegmentation.svc';

  it('CreateEmptyList -> Lists.Get row shape; duplicate name -> 500 MXDuplicateEntryException', async () => {
    const c = await call('POST', `${S}/CreateEmptyList`, { body: { Name: 'My List', Description: 'desc' } });
    expect(c.status).toBe(200);
    const id = String((c.obj.Message as Json).Id);
    expect(c.obj.Status).toBe('Success');
    const lists = await call('GET', `${L}/Lists.Get`);
    expect(lists.arr).toEqual([{ ListId: id, ListName: 'My List', ListDescription: 'desc', ListType: 'Static', MemberCount: 0 }]);

    const dup = await call('POST', `${S}/CreateEmptyList`, { body: { Name: 'my list' } });
    expect(dup.status).toBe(500);
    expect(dup.obj.ExceptionType).toBe('MXDuplicateEntryException');
    expect(fake.state.lists.size).toBe(1);

    expect((await call('POST', `${S}/CreateEmptyList`, { body: { Description: 'x' } })).status).toBe(500);
  });

  it('AddLeadsToStaticList adds members idempotently; an unknown lead id fails the whole call with "Records not associated with List"', async () => {
    const a = fake.seedLead({ EmailAddress: 'a@x.com' });
    const b = fake.seedLead({ EmailAddress: 'b@x.com' });
    const list = fake.seedList('L');
    const add = (ids: string[], listId = list.id): Promise<Reply> => call('POST', `${S}/AddLeadsToStaticList`, { body: { listId, leadIds: ids } });

    expect((await add([a.id, b.id])).status).toBe(200);
    expect((await add([a.id])).status).toBe(200);
    expect(list.members).toEqual([a.id, b.id]);

    const bad = await add(['00000000-dead-beef-0000-000000000000', a.id]);
    expect(bad.status).toBe(500);
    expect(bad.text).toContain('Records not associated with List');
    expect((await call('GET', `${L}/Lists.Get`)).arr[0].MemberCount).toBe(2);

    expect((await add([a.id], 'no-such-list')).status).toBe(500);
  });

  it('Lists/EmptyStaticList clears members; unknown list is a 500', async () => {
    const a = fake.seedLead({ EmailAddress: 'a@x.com' });
    const list = fake.seedList('L', [a.id]);
    const r = await call('GET', `${S}/Lists/EmptyStaticList`, { query: { ListId: list.id } });
    expect(r.status).toBe(200);
    expect(list.members).toEqual([]);
    expect((await call('GET', `${S}/Lists/EmptyStaticList`, { query: { ListId: 'nope' } })).status).toBe(500);
  });
});

describe('activity types and activities', () => {
  const P = '/ProspectActivity.svc';

  it('CreateType returns Id >= 200 (increasing); duplicate name -> 500 MXDuplicateEntryException', async () => {
    const a = await call('POST', `${P}/CreateType`, { body: { ActivityEventName: 'Webinar Registered', Fields: [{ SchemaName: 'mx_Custom_1', DisplayName: 'Webinar', DataType: 'String' }] } });
    const b = await call('POST', `${P}/CreateType`, { body: { ActivityEventName: 'Webinar Attended', Fields: [] } });
    const idA = (a.obj.Message as Json).Id as number;
    const idB = (b.obj.Message as Json).Id as number;
    expect(a.obj.Status).toBe('Success');
    expect(idA).toBeGreaterThanOrEqual(200);
    expect(idB).toBe(idA + 1);
    const dup = await call('POST', `${P}/CreateType`, { body: { ActivityEventName: 'webinar registered' } });
    expect(dup.status).toBe(500);
    expect(dup.obj.ExceptionType).toBe('MXDuplicateEntryException');
    expect((await call('POST', `${P}/CreateType`, { body: {} })).status).toBe(500);
    expect(fake.state.activityTypes.map((t) => t.name)).toEqual(['Webinar Registered', 'Webinar Attended']);
  });

  it('ActivityTypes.Get lists types; ActivityType.Get returns the field schema; unknown id is a 500; probed alternates are 404', async () => {
    expect((await call('GET', `${P}/ActivityTypes.Get`)).json).toEqual([]);
    const c = await call('POST', `${P}/CreateType`, { body: { ActivityEventName: 'T', Fields: [{ SchemaName: 'mx_Custom_1', DisplayName: 'One' }] } });
    const id = (c.obj.Message as Json).Id as number;
    const list = await call('GET', `${P}/ActivityTypes.Get`);
    expect(list.arr).toEqual([expect.objectContaining({ ActivityEvent: id, ActivityTypeName: 'T' })]);
    const det = await call('GET', `${P}/ActivityType.Get`, { query: { ActivityEvent: String(id) } });
    expect(det.obj).toMatchObject({ ActivityTypeName: 'T', Fields: [{ SchemaName: 'mx_Custom_1', DisplayName: 'One' }] });
    expect((await call('GET', `${P}/ActivityType.Get`, { query: { ActivityEvent: '9999' } })).status).toBe(500);
    expect((await call('GET', `${P}/Types.Get`)).status).toBe(404);
    expect((await call('POST', `${P}/ActivityTypes.Get`, { body: {} })).status).toBe(405);
  });

  it('Bulk/CustomActivity/Add/ByLeadId stores activities (200 JSON) and is all-or-nothing on a bad RelatedProspectId', async () => {
    const lead = fake.seedLead({ EmailAddress: 'act@x.com' });
    const A = `${P}/Bulk/CustomActivity/Add/ByLeadId`;
    const ok = await call('POST', A, {
      body: [
        { RelatedProspectId: lead.id, ActivityEvent: 201, ActivityNote: 'n1', Fields: [{ SchemaName: 'mx_Custom_1', Value: 'v' }] },
        { RelatedProspectId: lead.id, ActivityEvent: 202, ActivityNote: 'n2' },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toBeTruthy();
    expect(fake.state.activities).toHaveLength(2);
    expect(fake.state.activities[0]).toMatchObject({ relatedProspectId: lead.id, activityEvent: 201, activityNote: 'n1', fields: [{ SchemaName: 'mx_Custom_1', Value: 'v' }] });

    const bad = await call('POST', A, { body: [{ RelatedProspectId: lead.id, ActivityEvent: 201, ActivityNote: 'x' }, { RelatedProspectId: 'ghost', ActivityEvent: 201, ActivityNote: 'y' }] });
    expect(bad.status).toBe(500);
    expect(bad.obj.ExceptionType).toBe('MXInvalidInputException');
    expect(bad.obj.ExceptionMessage).toContain('ghost');
    expect(fake.state.activities).toHaveLength(2); // nothing from the failed call
    expect((await call('POST', A, { body: [{ ActivityEvent: 1, ActivityNote: 'n' }] })).status).toBe(500);
  });

  it('can be told to reject unknown activity types (strictActivityTypes)', async () => {
    const lead = fake.seedLead({ EmailAddress: 'strict@x.com' });
    fake.state.config.strictActivityTypes = true;
    const A = `${P}/Bulk/CustomActivity/Add/ByLeadId`;
    expect((await call('POST', A, { body: [{ RelatedProspectId: lead.id, ActivityEvent: 777, ActivityNote: 'n' }] })).status).toBe(500);
    const c = await call('POST', `${P}/CreateType`, { body: { ActivityEventName: 'Known' } });
    const id = (c.obj.Message as Json).Id as number;
    expect((await call('POST', A, { body: [{ RelatedProspectId: lead.id, ActivityEvent: id, ActivityNote: 'n' }] })).status).toBe(200);
  });
});

describe('SendEmailToLead and Users.Get', () => {
  const E = '/EmailMarketing.svc/SendEmailToLead';
  const email = (over: Json = {}): Json => ({
    SenderType: 'UserEmailAddress',
    Sender: 'sender@example.com',
    RecipientType: 'LeadEmailAddress',
    Recipient: 'to@x.com',
    EmailType: 'Html',
    Subject: 'Hi',
    ContentHTML: '<p>hi</p>',
    ContentText: 'hi',
    ...over,
  });

  it('succeeds for an active user sender + existing lead, returning {ID, MemberCount:1, TotalRecipient:1} and recording the email', async () => {
    fake.seedLead({ EmailAddress: 'to@x.com' });
    const r = await call('POST', E, { body: email({ EmailCategory: 'Promo', IncludeEmailFooter: true }) });
    expect(r.status).toBe(200);
    expect(r.obj).toMatchObject({ MemberCount: 1, TotalRecipient: 1 });
    expect(typeof r.obj.ID).toBe('string');
    expect(fake.state.sentEmails).toHaveLength(1);
    expect(fake.state.sentEmails[0]).toMatchObject({
      id: r.obj.ID,
      senderType: 'UserEmailAddress',
      sender: 'sender@example.com',
      recipient: 'to@x.com',
      subject: 'Hi',
      contentHtml: '<p>hi</p>',
      emailCategory: 'Promo',
      includeEmailFooter: true,
    });
  });

  it('rejects an unknown, missing, inactive or wrong-type sender with 500 MXMandatoryAttributeMissingException "Invalid Sender details."', async () => {
    fake.seedLead({ EmailAddress: 'to@x.com' });
    fake.state.users.push({ id: 'u-x', email: 'gone@example.com', firstName: 'G', lastName: 'One', role: 'Sales', statusCode: 1 });
    for (const over of [{ Sender: 'stranger@example.com' }, { Sender: undefined }, { Sender: 'gone@example.com' }, { SenderType: 'Bogus' }]) {
      const r = await call('POST', E, { body: email(over) });
      expect(r.status).toBe(500);
      expect(r.json).toEqual({ ExceptionType: 'MXMandatoryAttributeMissingException', ExceptionMessage: 'Invalid Sender details.' });
    }
    expect(fake.state.sentEmails).toHaveLength(0);
  });

  it('accepts APICaller (no Sender) by default and rejects it when apiCallerEnabled is off', async () => {
    fake.seedLead({ EmailAddress: 'to@x.com' });
    expect((await call('POST', E, { body: email({ SenderType: 'APICaller', Sender: undefined }) })).status).toBe(200);
    fake.state.config.apiCallerEnabled = false;
    expect((await call('POST', E, { body: email({ SenderType: 'APICaller', Sender: undefined }) })).status).toBe(500);
  });

  it('a valid sender with a recipient that is not a lead fails with "No lead found with RecipientType: LeadEmailAddress…"', async () => {
    const r = await call('POST', E, { body: email({ Recipient: 'ghost@x.com' }) });
    expect(r.status).toBe(500);
    expect(String(r.obj.ExceptionMessage)).toMatch(/^No lead found with RecipientType: LeadEmailAddress/);
    // and an invalid sender wins over a missing recipient (sender is validated first)
    const both = await call('POST', E, { body: email({ Recipient: 'ghost@x.com', Sender: 'nobody@example.com' }) });
    expect(both.obj.ExceptionMessage).toBe('Invalid Sender details.');
  });

  it('the mailDelivery fault yields 500 MXMailDeliveryException only after sender/recipient validation, and is consumed once', async () => {
    fake.seedLead({ EmailAddress: 'to@x.com' });
    fake.setFault({ match: 'SendEmailToLead', mailDelivery: true });
    // an invalid sender still reports the sender problem and does NOT consume the rule
    const badSender = await call('POST', E, { body: email({ Sender: 'nobody@example.com' }) });
    expect(badSender.obj.ExceptionType).toBe('MXMandatoryAttributeMissingException');
    const failed = await call('POST', E, { body: email() });
    expect(failed.status).toBe(500);
    expect(failed.obj.ExceptionType).toBe('MXMailDeliveryException');
    expect(fake.state.sentEmails).toHaveLength(0);
    expect((await call('POST', E, { body: email() })).status).toBe(200);
  });

  it('Users.Get lists users with UserId, EmailAddress, FirstName, LastName, Role and StatusCode (0 = active)', async () => {
    const custom = await startFakeLsq({ activeUsers: ['a@x.com', 'b@x.com'], inactiveUsers: ['old@x.com'] });
    try {
      const r = await call('GET', '/UserManagement.svc/Users.Get', { base: custom.url });
      expect(r.arr.map((u) => [u.EmailAddress, u.StatusCode])).toEqual([['a@x.com', 0], ['b@x.com', 0], ['old@x.com', 1]]);
      for (const u of r.arr) expect(Object.keys(u).sort()).toEqual(['EmailAddress', 'FirstName', 'LastName', 'Role', 'StatusCode', 'UserId']);
    } finally {
      await custom.stop();
    }
  });
});

describe('Webhook.Create', () => {
  it('returns {Status:"Success", Message:{Id:"wh_n"}} with incrementing ids and stores the webhook', async () => {
    const a = await call('POST', '/Webhook.svc/Create', { body: { Description: 'd', URL: 'https://app.test/hook', Method: 'POST', WebhookEvent: '2' } });
    const b = await call('POST', '/Webhook.svc/Create', { body: { URL: 'https://app.test/hook2' } });
    expect(a.json).toEqual({ Status: 'Success', Message: { Id: 'wh_1' } });
    expect((b.obj.Message as Json).Id).toBe('wh_2');
    expect(fake.state.webhooks[0]).toMatchObject({ id: 'wh_1', url: 'https://app.test/hook', webhookEvent: '2' });
    expect((await call('POST', '/Webhook.svc/Create', { body: { Description: 'no url' } })).status).toBe(500);
  });
});

// ===========================================================================
// FAULT INJECTION
// ===========================================================================

describe('fault injection', () => {
  it('429 with Retry-After, then normal service (times defaults to 1)', async () => {
    fake.setFault({ match: 'Lists.Get', status: 429, headers: { 'Retry-After': '7' } });
    const first = await call('GET', `${L}/Lists.Get`);
    expect(first.status).toBe(429);
    expect(first.headers.get('retry-after')).toBe('7');
    expect(first.text).toBe('Too Many Requests');
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200);
    expect(fake.state.faults[0]).toMatchObject({ remaining: 0, hits: 1 });
  });

  it('503, and 500 with and without an MX body', async () => {
    fake.setFault({ status: 503 });
    fake.setFault({ status: 500 });
    fake.setFault({ status: 500, body: { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'boom' } });
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(503);
    const plain = await call('GET', `${L}/Lists.Get`);
    expect(plain.status).toBe(500);
    expect(plain.json).toBeUndefined();
    const mx = await call('GET', `${L}/Lists.Get`);
    expect(mx.status).toBe(500);
    expect(mx.json).toEqual({ ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'boom' });
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200);
  });

  it('consumes rules in order, honours times and "forever", and clearFaults removes them', async () => {
    fake.setFault({ match: 'Lists.Get', status: 502, times: 2 });
    fake.setFault({ match: 'Lists.Get', status: 504, times: 'forever' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call('GET', `${L}/Lists.Get`)).status);
    expect(statuses).toEqual([502, 502, 504, 504, 504]);
    fake.clearFaults();
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200);
  });

  it('filters by method and by RegExp / substring', async () => {
    fake.setFault({ match: /Lead\.CreateOrUpdate$/, method: 'post', status: 503, times: 'forever' });
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200);
    expect((await upsert({ EmailAddress: 'f@x.com' })).status).toBe(503);
    fake.clearFaults();
    fake.setFault({ match: 'Lists.Get', method: 'POST', status: 503, times: 'forever' });
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200); // method mismatch: untouched
  });

  it('a faulted request is logged as faulted and the rule is applied before authentication', async () => {
    fake.setFault({ status: 503 });
    const r = await call('GET', `${L}/Lists.Get`, { auth: false });
    expect(r.status).toBe(503);
    expect(fake.state.requestLog.at(-1)).toMatchObject({ faulted: true, status: 503 });
  });

  it('delayMs makes a response slow (a client with a short timeout aborts; one without waits)', async () => {
    fake.setFault({ match: 'Lists.Get', delayMs: 400, times: 2 });
    const t0 = Date.now();
    await expect(call('GET', `${L}/Lists.Get`, { signal: AbortSignal.timeout(80) })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - t0).toBeLessThan(380);

    const t1 = Date.now();
    const slow = await call('GET', `${L}/Lists.Get`);
    expect(slow.status).toBe(200); // delay-only rule: handled normally afterwards
    expect(Date.now() - t1).toBeGreaterThanOrEqual(350);
  });

  it('delayMs combined with a status delays the faulty response', async () => {
    fake.setFault({ match: 'Lists.Get', status: 503, delayMs: 200 });
    const t = Date.now();
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(503);
    expect(Date.now() - t).toBeGreaterThanOrEqual(170);
  });

  it('dropConnection destroys the socket so the client sees a network error', async () => {
    fake.setFault({ match: 'Lists.Get', dropConnection: true });
    await expect(call('GET', `${L}/Lists.Get`)).rejects.toThrow(/fetch failed/);
    expect((await call('GET', `${L}/Lists.Get`)).status).toBe(200);
    expect(fake.state.requestLog.filter((r) => r.faulted)).toHaveLength(1);
    expect(fake.state.requestLog[0].status).toBeUndefined();
  });

  it('a string body is sent raw as text/plain; other bodies as JSON', async () => {
    fake.setFault({ status: 500, body: 'plain failure' });
    const r = await call('GET', `${L}/Lists.Get`);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(r.text).toBe('plain failure');
  });
});

describe('state helpers', () => {
  it('reset() wipes data, faults, log and id counters but keeps the same state object; requestsTo filters the log', async () => {
    const stateRef = fake.state;
    const lead = fake.seedLead({ EmailAddress: 'r@x.com' });
    fake.seedList('X');
    fake.setFault({ status: 503, times: 'forever' });
    fake.reset();
    expect(fake.state).toBe(stateRef);
    expect(stateRef.leads.size).toBe(0);
    expect(stateRef.leadsByEmail.size).toBe(0);
    expect(stateRef.lists.size).toBe(0);
    expect(stateRef.faults).toHaveLength(0);
    expect(stateRef.requestLog).toHaveLength(0);
    expect(fake.seedLead({ EmailAddress: 'r@x.com' }).id).toBe(lead.id); // deterministic ids restart

    await call('GET', `${L}/Lists.Get`);
    await call('GET', `${L}/LeadsMetaData.Get`);
    expect(fake.requestsTo('Lists.Get')).toHaveLength(1);
    expect(fake.requestsTo(/LeadManagement\.svc/, 'POST')).toHaveLength(0);
    expect(fake.requestsTo(/LeadManagement\.svc/, 'GET')).toHaveLength(2);
  });

  it('stop() is idempotent and closes the port', async () => {
    const tmp = await startFakeLsq();
    await tmp.stop();
    await tmp.stop();
    await expect(fetch(`${tmp.url}${L}/Lists.Get?accessKey=a&secretKey=b`)).rejects.toThrow();
  });
});

// ===========================================================================
// CONTRACT: the app's REAL client against the fake, over real HTTP
// ===========================================================================

describe('contract: lib/leadsquared.ts against the fake', () => {
  const act = (id: string, note = 'n', event = 201): { RelatedProspectId: string; ActivityEvent: number; ActivityNote: string } => ({ RelatedProspectId: id, ActivityEvent: event, ActivityNote: note });
  const field = (Attribute: string, Value: string): { Attribute: string; Value: string } => ({ Attribute, Value });

  it('getLeadsMetadata works and shows the missing custom fields', async () => {
    const meta = await getLeadsMetadata();
    const names = meta.map((m) => m.SchemaName);
    expect(names).toContain('EmailAddress');
    expect(names).not.toContain('mx_Webinar_ICP_Score');
  });

  it('getLeadsMetadata surfaces a 401 as LeadSquaredError for wrong keys on a strict fake', async () => {
    const strict = await startFakeLsq({ accessKey: 'right', secretKey: 'right' });
    const prev = process.env.LSQ_API_BASE_URL;
    process.env.LSQ_API_BASE_URL = strict.url;
    try {
      await expect(getLeadsMetadata({ accessKey: 'wrong', secretKey: 'wrong' })).rejects.toMatchObject({ name: 'LeadSquaredError', status: 401 });
      await expect(getLeadsMetadata({ accessKey: 'right', secretKey: 'right' })).resolves.toBeInstanceOf(Array);
      expect(strict.state.requestLog).toHaveLength(2); // a 401 is never retried
    } finally {
      process.env.LSQ_API_BASE_URL = prev;
      await strict.stop();
    }
  });

  it('createOrUpdateLead upserts and getLeadByEmailAddress / getLeadById read it back', async () => {
    const res = await createOrUpdateLead([field('EmailAddress', 'Cy@Example.com'), field('FirstName', 'Cy'), field('Company', 'Acme')]);
    expect(res.Status).toBe('Success');
    expect(res.Message.AffectedRows).toBe(1);
    const again = await createOrUpdateLead([field('EmailAddress', 'cy@example.com'), field('LastName', 'Zed')]);
    expect(again.Message.Id).toBe(res.Message.Id);

    const byEmail = await getLeadByEmailAddress('cy@example.com');
    expect(byEmail).toMatchObject({ ProspectID: res.Message.Id, FirstName: 'Cy', LastName: 'Zed', Company: 'Acme' });
    expect(await getLeadByEmailAddress('nobody@example.com')).toBeNull();
    expect(await getLeadById(res.Message.Id)).toMatchObject({ ProspectID: res.Message.Id });
    expect(await getLeadById('missing-id')).toBeNull();
    expect(fake.requestsTo('Leads.GetByEmailAddress')[0].query).toEqual({ emailaddress: 'cy@example.com' });
    expect(fake.requestsTo('Lead.CreateOrUpdate')[0].query).toEqual({ postUpdatedLead: 'true' });
  });

  it('an unknown attribute surfaces as LeadSquaredError(500) with the exact MXUnknownAttributeException body, and is not retried', async () => {
    const err = await createOrUpdateLead([field('EmailAddress', 'x@example.com'), field('mx_Webinar_ICP_Score', '90')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadSquaredError);
    const lsq = err as LeadSquaredError;
    expect(lsq.status).toBe(500);
    expect(lsq.body).toEqual({ ExceptionType: 'MXUnknownAttributeException', ExceptionMessage: 'Attribute(s) does not exist - mx_Webinar_ICP_Score.' });
    expect(lsq.message).toContain('MXUnknownAttributeException');
    expect(fake.requestsTo('Lead.CreateOrUpdate')).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();

    // ...and works once the tenant has the field
    fake.state.config.customFields.push('mx_Webinar_ICP_Score');
    await expect(createOrUpdateLead([field('EmailAddress', 'x@example.com'), field('mx_Webinar_ICP_Score', '90')])).resolves.toMatchObject({ Status: 'Success' });
  });

  it('bulkCreateOrUpdateLeads maps partial failures (server-side and client-side) back to original indexes', async () => {
    const out = await bulkCreateOrUpdateLeads([
      [field('EmailAddress', 'ok1@example.com')],
      [field('EmailAddress', 'bad-attr@example.com'), field('mx_Nope', 'x')], // rejected by the fake, inline
      [field('EmailAddress', 'not-an-email')], // rejected locally, never sent
      [field('EmailAddress', 'ok2@example.com')],
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ RowNumber: 0, LeadCreated: true });
    expect(out[0].LeadId).toMatch(/\S/);
    expect(out[1]).toMatchObject({ RowNumber: 1, LeadId: '', ExceptionType: 'MXUnknownAttributeException' });
    expect(out[1].ErrorMessage).toContain('mx_Nope');
    expect(out[2]).toMatchObject({ RowNumber: 2, LeadId: '', ExceptionType: 'LsqPayloadError' });
    expect(out[3]).toMatchObject({ RowNumber: 3, LeadCreated: true });
    expect(fake.requestsTo('Bulk/CreateOrUpdate')).toHaveLength(1);
    expect((fake.requestsTo('Bulk/CreateOrUpdate')[0].body as unknown[]).length).toBe(3); // the locally invalid row was not sent
    expect(fake.state.leads.size).toBe(2);
  });

  it('bulkCreateOrUpdateLeads chunks 60 rows into 25/25/10 calls; a re-run reports updates with the same ids', async () => {
    const leads = Array.from({ length: 60 }, (_, i) => [field('EmailAddress', `bulk${i}@example.com`)]);
    const first = await bulkCreateOrUpdateLeads(leads);
    const calls = fake.requestsTo('Bulk/CreateOrUpdate');
    expect(calls.map((c) => (c.body as unknown[]).length)).toEqual([25, 25, 10]);
    expect(first).toHaveLength(60);
    first.forEach((r, i) => expect(r).toMatchObject({ RowNumber: i, LeadCreated: true, LeadUpdated: false }));
    expect(new Set(first.map((r) => r.LeadId)).size).toBe(60);
    expect(fake.state.leads.size).toBe(60);

    const second = await bulkCreateOrUpdateLeads(leads);
    second.forEach((r, i) => expect(r).toMatchObject({ RowNumber: i, LeadCreated: false, LeadUpdated: true, LeadId: first[i].LeadId }));
    expect(fake.state.leads.size).toBe(60);
  });

  it('a 429 with Retry-After on an idempotent call is honoured (sleep gets the header value) and then succeeds', async () => {
    fake.setFault({ match: 'Lists.Get', status: 429, headers: { 'Retry-After': '2' } });
    await expect(getLists()).resolves.toEqual([]);
    expect(fake.requestsTo('Lists.Get')).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('a 429 on a non-idempotent POST is replayed, and the activity lands exactly once', async () => {
    const lead = fake.seedLead({ EmailAddress: 'a@example.com' });
    fake.setFault({ match: 'CustomActivity', status: 429, headers: { 'Retry-After': '1' } });
    await expect(pushCustomActivities([act(lead.id)])).resolves.toBe(1);
    expect(fake.requestsTo('CustomActivity')).toHaveLength(2);
    expect(fake.state.activities).toHaveLength(1);
  });

  it('a persistent 429 gives up after 4 attempts with LeadSquaredError(429)', async () => {
    fake.setFault({ match: 'Lists.Get', status: 429, times: 'forever' });
    await expect(getLists()).rejects.toMatchObject({ name: 'LeadSquaredError', status: 429 });
    expect(fake.requestsTo('Lists.Get')).toHaveLength(4);
  });

  it('does not replay a non-idempotent POST after 503', async () => {
    const lead = fake.seedLead({ EmailAddress: 'a@example.com' });
    fake.setFault({ match: 'CustomActivity', status: 503, times: 2 });
    await expect(pushCustomActivities([act(lead.id)])).rejects.toThrow();
    expect(fake.requestsTo('CustomActivity')).toHaveLength(1);
    expect(fake.state.activities).toHaveLength(0);
  });

  it('does NOT replay a non-idempotent POST after a plain 500 (even though it would have succeeded next time)', async () => {
    const lead = fake.seedLead({ EmailAddress: 'a@example.com' });
    fake.setFault({ match: 'CustomActivity', status: 500 });
    await expect(pushCustomActivities([act(lead.id)])).rejects.toBeInstanceOf(LeadSquaredError);
    expect(fake.requestsTo('CustomActivity')).toHaveLength(1);
    expect(fake.state.activities).toHaveLength(0);
  });

  it('DOES replay a plain 500 on an idempotent upsert', async () => {
    fake.setFault({ match: 'Lead.CreateOrUpdate', status: 500 });
    await expect(createOrUpdateLead([field('EmailAddress', 'r@example.com')])).resolves.toMatchObject({ Status: 'Success' });
    expect(fake.requestsTo('Lead.CreateOrUpdate')).toHaveLength(2);
    expect(fake.state.leads.size).toBe(1);
  });

  it('does not retry an MX…Exception 500, even on an idempotent GET', async () => {
    fake.setFault({ match: 'Lists.Get', status: 500, body: { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'nope' }, times: 'forever' });
    await expect(getLists()).rejects.toMatchObject({ name: 'LeadSquaredError', status: 500 });
    expect(fake.requestsTo('Lists.Get')).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a dropped connection is retried for reads but never for a non-idempotent write', async () => {
    fake.setFault({ match: 'Lists.Get', dropConnection: true });
    await expect(getLists()).resolves.toEqual([]);
    expect(fake.requestsTo('Lists.Get')).toHaveLength(2);

    const lead = fake.seedLead({ EmailAddress: 'a@example.com' });
    fake.setFault({ match: 'CustomActivity', dropConnection: true });
    await expect(pushCustomActivities([act(lead.id)])).rejects.toThrow(/failed/);
    expect(fake.requestsTo('CustomActivity')).toHaveLength(1);
  });

  it('pushCustomActivities chunks by 25 and reports how many landed when a later chunk fails', async () => {
    const lead = fake.seedLead({ EmailAddress: 'a@example.com' });
    const acts = Array.from({ length: 60 }, (_, i) => act(lead.id, `n${i}`));
    await expect(pushCustomActivities(acts)).resolves.toBe(60);
    expect(fake.requestsTo('CustomActivity').map((c) => (c.body as unknown[]).length)).toEqual([25, 25, 10]);
    expect(fake.state.activities).toHaveLength(60);

    fake.state.activities.length = 0;
    fake.state.requestLog.length = 0;
    // second chunk contains an activity for a lead that does not exist -> deterministic MX failure
    const mixed = [...Array.from({ length: 25 }, (_, i) => act(lead.id, `ok${i}`)), act('ghost-lead', 'bad')];
    const err = await pushCustomActivities(mixed).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartialActivityPushError);
    expect((err as PartialActivityPushError).pushed).toBe(25);
    expect(fake.state.activities).toHaveLength(25);
  });

  it('a failing first chunk throws the raw LeadSquaredError (RelatedProspectId must exist)', async () => {
    const err = await pushCustomActivities([act('ghost-lead')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadSquaredError);
    expect((err as LeadSquaredError).body).toMatchObject({ ExceptionType: 'MXInvalidInputException' });
  });

  it('createActivityType + listActivityTypes + getActivityTypeDetails round-trip', async () => {
    const empty = await listActivityTypes();
    expect(empty.types).toEqual([]);
    expect(empty.sourcePath).toBeNull();

    const id = await createActivityType('Webinar Registered', [{ schemaName: 'mx_Custom_1', displayName: 'Webinar' }]);
    expect(id).toBeGreaterThanOrEqual(200);
    const listed = await listActivityTypes();
    expect(listed.types).toEqual([{ id, name: 'Webinar Registered' }]);
    expect(listed.sourcePath).toBe('GET /ProspectActivity.svc/ActivityTypes.Get');
    expect(await getActivityTypeDetails(id)).toEqual({ name: 'Webinar Registered', fields: [{ schemaName: 'mx_Custom_1', displayName: 'Webinar' }] });
    expect(await getActivityTypeDetails(99999)).toBeNull();
    await expect(createActivityType('Webinar Registered', [])).rejects.toMatchObject({ status: 500, body: { ExceptionType: 'MXDuplicateEntryException' } });
  });

  it('getLists / createEmptyList / addLeadsToStaticList / emptyStaticList / getLeadsInList work end to end', async () => {
    expect(await getLists()).toEqual([]);
    const listId = await createEmptyList('Suppression', 'desc');
    await expect(createEmptyList('Suppression', 'again')).rejects.toMatchObject({ status: 500, body: { ExceptionType: 'MXDuplicateEntryException' } });

    const leads = Array.from({ length: 60 }, (_, i) => fake.seedLead({ EmailAddress: `m${i}@example.com`, FirstName: `M${i}` }));
    await addLeadsToStaticList(listId, leads.map((l) => l.id));
    expect(fake.requestsTo('AddLeadsToStaticList').map((c) => (c.body as { leadIds: string[] }).leadIds.length)).toEqual([25, 25, 10]);
    const lists = await getLists();
    expect(lists).toEqual([{ ListId: listId, ListName: 'Suppression', ListDescription: 'desc', ListType: 'Static', MemberCount: 60 }]);

    const rows = await getLeadsInList(listId, 25);
    expect(rows).toHaveLength(60);
    expect(rows[0]).toMatchObject({ EmailAddress: 'm0@example.com', FirstName: 'M0' });
    expect(fake.requestsTo('Retrieve/BySearchParameter')).toHaveLength(3);
    expect(await getLeadsInList(listId, 25, 30)).toHaveLength(30);

    await emptyStaticList(listId);
    expect((await getLists())[0].MemberCount).toBe(0);
  });

  it('addLeadsToStaticList with an unknown lead id throws "Records not associated with List"', async () => {
    const listId = await createEmptyList('L', '');
    const err = await addLeadsToStaticList(listId, ['00000000-0000-4000-8000-00000000ffff']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadSquaredError);
    expect((err as LeadSquaredError).message).toContain('Records not associated with List');
    expect(fake.requestsTo('AddLeadsToStaticList')).toHaveLength(1);
  });

  it('sendEmailToLead succeeds with the configured active-user sender', async () => {
    fake.seedLead({ EmailAddress: 'to@example.com' });
    const res = await sendEmailToLead({ recipientEmail: 'to@example.com', subject: 'Hello', contentHtml: '<b>x</b>', contentText: 'x', emailCategory: 'Promo' });
    expect(res).toMatchObject({ MemberCount: 1, TotalRecipient: 1 });
    expect(fake.state.sentEmails).toHaveLength(1);
    expect(fake.state.sentEmails[0]).toMatchObject({ senderType: 'UserEmailAddress', sender: 'sender@example.com', recipient: 'to@example.com', subject: 'Hello', emailCategory: 'Promo', includeEmailFooter: true });
  });

  it('sendEmailToLead falls back to APICaller when the configured sender is not an active user', async () => {
    h.config.senderEmail = 'stranger@example.com';
    fake.seedLead({ EmailAddress: 'to@example.com' });
    await sendEmailToLead({ recipientEmail: 'to@example.com', subject: 'S', contentHtml: 'h', contentText: 't' });
    expect(fake.requestsTo('SendEmailToLead')).toHaveLength(2);
    expect(fake.state.sentEmails.map((e) => e.senderType)).toEqual(['APICaller']);
  });

  it('sendEmailToLead reports "rejected BOTH sender identities" when neither identity is valid', async () => {
    h.config.senderEmail = 'stranger@example.com';
    fake.state.config.apiCallerEnabled = false;
    fake.seedLead({ EmailAddress: 'to@example.com' });
    await expect(sendEmailToLead({ recipientEmail: 'to@example.com', subject: 'S', contentHtml: 'h', contentText: 't' })).rejects.toThrow(/rejected BOTH sender identities/);
    expect(fake.state.sentEmails).toHaveLength(0);
  });

  it('sendEmailToLead turns a mailDelivery fault into the account-level MXMailDeliveryException message, without trying the other identity', async () => {
    fake.seedLead({ EmailAddress: 'to@example.com' });
    fake.setFault({ match: 'SendEmailToLead', mailDelivery: true });
    await expect(sendEmailToLead({ recipientEmail: 'to@example.com', subject: 'S', contentHtml: 'h', contentText: 't' })).rejects.toThrow(/MXMailDeliveryException/);
    expect(fake.requestsTo('SendEmailToLead')).toHaveLength(1);
  });

  it('sendEmailToLead surfaces "No lead found" for a recipient that is not a lead (and does not retry it)', async () => {
    await expect(sendEmailToLead({ recipientEmail: 'ghost@example.com', subject: 'S', contentHtml: 'h', contentText: 't' })).rejects.toThrow(/No lead found with RecipientType: LeadEmailAddress/);
    expect(fake.requestsTo('SendEmailToLead')).toHaveLength(1);
  });

  it('probeSenderIdentity distinguishes valid / invalid senders without sending mail', async () => {
    expect((await probeSenderIdentity('sender@example.com')).verdict).toBe('valid');
    expect((await probeSenderIdentity('stranger@example.com')).verdict).toBe('invalid');
    expect(fake.state.sentEmails).toHaveLength(0);
  });

  it('listUsers maps UserId/EmailAddress/StatusCode to the app shape', async () => {
    fake.state.users.push({ id: 'u-9', email: 'old@example.com', firstName: 'Old', lastName: 'Timer', role: 'Sales', statusCode: 1 });
    const users = await listUsers();
    expect(users.find((u) => u.email === 'sender@example.com')).toMatchObject({ active: true, role: 'Administrator' });
    expect(users.find((u) => u.email === 'old@example.com')).toEqual({ id: 'u-9', email: 'old@example.com', firstName: 'Old', lastName: 'Timer', role: 'Sales', active: false });
  });

  it('registerLeadSquaredWebhook registers and returns the wh_n id; reports ok:false on a deterministic failure', async () => {
    const ok = await registerLeadSquaredWebhook('https://app.test/api/webhooks/leadsquared/activity');
    expect(ok).toMatchObject({ ok: true, webhookId: 'wh_1' });
    expect(fake.state.webhooks[0]).toMatchObject({ url: 'https://app.test/api/webhooks/leadsquared/activity', webhookEvent: '2', method: 'POST', contentType: 'application/json' });

    fake.setFault({ match: 'Webhook.svc', status: 500, body: { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'quota' } });
    const failed = await registerLeadSquaredWebhook('https://app.test/x');
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain('MXInvalidInputException');
    expect(fake.state.webhooks).toHaveLength(1);
  });
});
