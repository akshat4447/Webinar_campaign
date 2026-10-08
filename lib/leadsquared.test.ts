import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => ({ accessKey: 'AK', secretKey: 'SK', host: 'api-in21.leadsquared.com' })[key]),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

import { createOrUpdateLead, getLists, isRetryableLsqFailure, LeadSquaredError, PartialActivityPushError, pushCustomActivities, getLeadActivities, resetLeadSchemaCache, setLeadSchemaOverrideForTests } from './leadsquared';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const fetchMock = vi.fn();
beforeEach(() => {
  resetLeadSchemaCache();
  setLeadSchemaOverrideForTests(null); // field discovery has its own tests; keep these fetch sequences exact
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('isRetryableLsqFailure', () => {
  it('retries 429 but reserves 503 retries for idempotent calls', () => {
    expect(isRetryableLsqFailure(429, null, false)).toBe(true);
    expect(isRetryableLsqFailure(503, null, false)).toBe(false);
  });
  it('retries other 5xx and network errors only when replay is safe', () => {
    expect(isRetryableLsqFailure(502, 'bad gateway', true)).toBe(true);
    expect(isRetryableLsqFailure(502, 'bad gateway', false)).toBe(false);
    expect(isRetryableLsqFailure(null, null, true)).toBe(true);
    expect(isRetryableLsqFailure(null, null, false)).toBe(false);
  });
  it('never retries a deterministic MX…Exception 500 or a 4xx', () => {
    expect(isRetryableLsqFailure(500, { ExceptionType: 'MXInvalidInputException' }, true)).toBe(false);
    expect(isRetryableLsqFailure(500, '{"ExceptionType":"MXMailDeliveryException"}', true)).toBe(false);
    expect(isRetryableLsqFailure(400, null, true)).toBe(false);
    expect(isRetryableLsqFailure(401, null, true)).toBe(false);
  });
});

describe('lsqFetch behaviour (via the public API)', () => {
  it('retries a transient 500 on an idempotent upsert and succeeds', async () => {
    fetchMock.mockResolvedValueOnce(res(500, 'oops')).mockResolvedValueOnce(res(200, { Status: 'Success', Message: { Id: 'L1', AffectedRows: 1 } }));
    const out = await createOrUpdateLead([{ Attribute: 'EmailAddress', Value: 'a@b.com' }]);
    expect(out.Message.Id).toBe('L1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT replay a custom-activity POST after a 500 (it may already have been recorded)', async () => {
    fetchMock.mockImplementation(async () => res(500, 'oops'));
    await expect(pushCustomActivities([{ RelatedProspectId: 'p', ActivityEvent: 1, ActivityNote: 'n' }])).rejects.toBeInstanceOf(LeadSquaredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('DOES replay a custom-activity POST after a 429', async () => {
    fetchMock.mockResolvedValueOnce(res(429, 'slow down', { 'retry-after': '1' })).mockResolvedValueOnce(res(200, {Status:'Success',Message:{Count:1}}));
    await expect(pushCustomActivities([{ RelatedProspectId: 'p', ActivityEvent: 1, ActivityNote: 'n' }])).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a deterministic application error', async () => {
    fetchMock.mockImplementation(async () => res(500, { ExceptionType: 'MXInvalidInputException', ExceptionMessage: 'bad' }));
    await expect(createOrUpdateLead([{ Attribute: 'EmailAddress', Value: 'a@b.com' }])).rejects.toBeInstanceOf(LeadSquaredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after 4 attempts on a persistent 429 and surfaces the LeadSquaredError', async () => {
    fetchMock.mockImplementation(async () => res(429, 'rate limited'));
    await expect(getLists()).rejects.toMatchObject({ name: 'LeadSquaredError', status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('retries a network failure for reads but not for a non-idempotent write', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(res(200, []));
    await expect(getLists()).resolves.toEqual([]);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(pushCustomActivities([{ RelatedProspectId: 'p', ActivityEvent: 1, ActivityNote: 'n' }])).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a timeout signal with every request', async () => {
    fetchMock.mockImplementation(async () => res(200, []));
    await getLists();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('chunks activities by 25 and reports exactly how many landed when a later chunk fails', async () => {
    const acts = Array.from({ length: 30 }, (_, i) => ({ RelatedProspectId: `p${i}`, ActivityEvent: 1, ActivityNote: 'n' }));
    fetchMock.mockResolvedValueOnce(res(200, {Status:'Success',Message:{Count:25}})).mockResolvedValueOnce(res(500, 'boom'));
    const err = await pushCustomActivities(acts).catch((e) => e);
    expect(err).toBeInstanceOf(PartialActivityPushError);
    expect((err as PartialActivityPushError).pushed).toBe(25);
  });

  it('rejects an invalid lead payload locally, before any network call', async () => {
    await expect(createOrUpdateLead([{ Attribute: 'EmailAddress', Value: 'not-an-email' }])).rejects.toThrow(/valid EmailAddress/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid activity locally, before any network call', async () => {
    await expect(pushCustomActivities([{ RelatedProspectId: '', ActivityEvent: 1, ActivityNote: 'n' }])).rejects.toThrow(/RelatedProspectId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('bulkCreateOrUpdateLeads', () => {
  const lead = (email: string) => [{ Attribute: 'EmailAddress', Value: email }];

  it('reports an invalid row as that row’s failure and still upserts the valid ones', async () => {
    const { bulkCreateOrUpdateLeads } = await import('./leadsquared');
    fetchMock.mockResolvedValueOnce(
      res(200, [
        { RowNumber: 1, LeadId: 'A', LeadCreated: true, LeadUpdated: false, AffectedRows: 1 },
        { RowNumber: 2, LeadId: 'C', LeadCreated: true, LeadUpdated: false, AffectedRows: 1 },
      ])
    );
    const out = await bulkCreateOrUpdateLeads([lead('a@x.com'), lead('not-an-email'), lead('c@x.com')]);

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ RowNumber: 0, LeadId: 'A' });
    expect(out[1]).toMatchObject({ RowNumber: 1, LeadId: '', ExceptionType: 'LsqPayloadError' });
    expect(out[2]).toMatchObject({ RowNumber: 2, LeadId: 'C' }); // remapped from LSQ's chunk-local row 2
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent).toHaveLength(2); // the invalid lead was never sent
  });

  it('maps LeadSquared’s 1-based chunk row numbers back to original indexes across chunks', async () => {
    const { bulkCreateOrUpdateLeads } = await import('./leadsquared');
    const leads = Array.from({ length: 27 }, (_, i) => lead(`u${i}@x.com`));
    const answer = (n: number) => Array.from({ length: n }, (_, k) => ({ RowNumber: k + 1, LeadId: `L${k}`, LeadCreated: true, LeadUpdated: false, AffectedRows: 1 }));
    fetchMock.mockResolvedValueOnce(res(200, answer(25))).mockResolvedValueOnce(res(200, answer(2)));
    const out = await bulkCreateOrUpdateLeads(leads);
    expect(out).toHaveLength(27);
    expect(out[25]).toMatchObject({ RowNumber: 25, LeadId: 'L0' });
    expect(out[26]).toMatchObject({ RowNumber: 26, LeadId: 'L1' });
  });

  it('turns rows LeadSquared never answered into explicit failures, not undefined holes', async () => {
    const { bulkCreateOrUpdateLeads } = await import('./leadsquared');
    fetchMock.mockResolvedValueOnce(res(200, [{ RowNumber: 1, LeadId: 'A', LeadCreated: true, LeadUpdated: false, AffectedRows: 1 }]));
    const out = await bulkCreateOrUpdateLeads([lead('a@x.com'), lead('b@x.com')]);
    expect(out[1]).toMatchObject({ LeadId: '', ExceptionType: 'MissingResult' });
  });
});

describe('LeadSquared activity creation evidence',()=>{
 it('rejects an application-level error carried by HTTP 200',async()=>{fetchMock.mockResolvedValueOnce(res(200,{Status:'Error',Message:'Invalid ActivityEvent'}));await expect(pushCustomActivities([{RelatedProspectId:'p',ActivityEvent:202,ActivityNote:'test'}])).rejects.toMatchObject({status:400});expect(fetchMock).toHaveBeenCalledTimes(1);});
 it('counts an activity only when its response proves creation',async()=>{fetchMock.mockResolvedValueOnce(res(200,{Response:[{RowNumber:1,ActivityCreated:true,ProspectActivityId:'activity-1'}]}));await expect(pushCustomActivities([{RelatedProspectId:'p',ActivityEvent:302,ActivityNote:'test'}])).resolves.toBe(1);});
 it('rejects individual ActivityCreated=false results even on HTTP 200',async()=>{fetchMock.mockResolvedValueOnce(res(200,{Response:[{RowNumber:1,ActivityCreated:false,ExceptionMessage:'Invalid code'}]}));await expect(pushCustomActivities([{RelatedProspectId:'p',ActivityEvent:202,ActivityNote:'test'}])).rejects.toMatchObject({status:400});});
 it('preserves actual accepted row indexes for a non-contiguous partial batch',async()=>{fetchMock.mockResolvedValueOnce(res(200,{Response:[{RowNumber:1,ActivityCreated:false},{RowNumber:2,ActivityCreated:true,ProspectActivityId:'activity-2'}]}));const result=await pushCustomActivities([{RelatedProspectId:'p1',ActivityEvent:302,ActivityNote:'test'},{RelatedProspectId:'p2',ActivityEvent:302,ActivityNote:'test'}]).catch(e=>e);expect(result).toBeInstanceOf(PartialActivityPushError);expect(result.acceptedIndices).toEqual([1]);expect(result.pushed).toBe(1);});
 it('holds an incomplete success response as uncertain',async()=>{fetchMock.mockResolvedValueOnce(res(200,{}));await expect(pushCustomActivities([{RelatedProspectId:'p',ActivityEvent:302,ActivityNote:'test'}])).rejects.toThrow('uncertain');});
 it('audits lead activities through a bounded read-only POST',async()=>{fetchMock.mockResolvedValueOnce(res(200,[{ProspectActivityId:'record-1'}]));expect(await getLeadActivities('lead-1',2,302)).toHaveLength(1);const [url,options]=fetchMock.mock.calls[0];expect(url).toContain('leadId=lead-1');expect(JSON.parse(options.body)).toEqual({Parameter:{ActivityEvent:302},Paging:{Offset:'2',RowCount:'100'}});});
});
