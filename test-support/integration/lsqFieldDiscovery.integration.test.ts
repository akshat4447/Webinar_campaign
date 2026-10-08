// Field discovery against the fake LeadSquared tenant. REPRODUCES the live failure: a tenant that lacks
// the optional custom fields (mx_Seniority, mx_Function, mx_Webinar_ICP_Score) used to fail every lead
// with MXUnknownAttributeException. Now unknown custom fields are skipped and reported.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeLsq, type FakeLsq } from '../fakes/lsqFake';

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => ({ accessKey: 'AK', secretKey: 'SK', host: 'x', senderEmail: 'sender@example.com' } as Record<string, string>)[key]),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

import { bulkCreateOrUpdateLeads, createOrUpdateLead, resetLeadSchemaCache, takeSkippedCustomFields, getTenantCustomFieldNames, splitUnknownCustomFields, type LeadField } from '@/lib/leadsquared';
import { leadFieldsFor } from '@/lib/leadSync';

let fake: FakeLsq;
const original = process.env.LSQ_API_BASE_URL;
beforeAll(async () => {
  fake = await startFakeLsq({ accessKey: 'AK', secretKey: 'SK' });
  process.env.LSQ_API_BASE_URL = fake.url;
});
afterAll(async () => {
  await fake.stop();
  if (original === undefined) delete process.env.LSQ_API_BASE_URL;
  else process.env.LSQ_API_BASE_URL = original;
});
beforeEach(() => {
  fake.reset();
  resetLeadSchemaCache();
});

const f = (Attribute: string, Value: string): LeadField => ({ Attribute, Value });
const contact = { email: 'a@x.com', name: 'Ann Lee', account: 'Acme', title: 'VP', score: 88, seniority: 'VP', function: 'Marketing', phone: null, extraFieldsJson: null };

describe('REGRESSION: tenant without the optional custom fields', () => {
  it('creates the lead anyway (the three mx_ fields are skipped, not fatal)', async () => {
    const res = await createOrUpdateLead(leadFieldsFor(contact, null));
    expect(res.Status).toBe('Success');
    const stored = [...fake.state.leads.values()][0];
    expect(JSON.stringify(stored)).not.toContain('mx_Seniority');
    expect(takeSkippedCustomFields().sort()).toEqual(['mx_Function', 'mx_Seniority', 'mx_Webinar_ICP_Score']);
  });

  it('bulk upsert succeeds for every row and reports each skipped field once', async () => {
    const out = await bulkCreateOrUpdateLeads([1, 2, 3].map((i) => leadFieldsFor({ ...contact, email: `u${i}@x.com` }, null)));
    expect(out.every((r) => r.LeadId && !r.ExceptionType)).toBe(true);
    expect(takeSkippedCustomFields()).toHaveLength(3); // deduplicated across rows
    expect(takeSkippedCustomFields()).toHaveLength(0); // and cleared once taken
  });
});

describe('when the tenant HAS the fields', () => {
  it('sends them (no data is lost)', async () => {
    fake.state.config.customFields.push('mx_Seniority', 'mx_Function', 'mx_Webinar_ICP_Score');
    await createOrUpdateLead(leadFieldsFor(contact, null));
    const body = fake.requestsTo('Lead.CreateOrUpdate')[0].body as LeadField[];
    expect(body.map((x) => x.Attribute)).toEqual(expect.arrayContaining(['mx_Seniority', 'mx_Function', 'mx_Webinar_ICP_Score']));
    expect(takeSkippedCustomFields()).toEqual([]);
  });

  it('matches field names case-insensitively', async () => {
    fake.state.config.customFields.push('MX_SENIORITY');
    expect((await getTenantCustomFieldNames())?.has('mx_seniority')).toBe(true);
  });

  it('keeps only the fields that exist when the tenant has some of them', async () => {
    fake.state.config.customFields.push('mx_Seniority');
    await createOrUpdateLead(leadFieldsFor(contact, null));
    const attrs = (fake.requestsTo('Lead.CreateOrUpdate')[0].body as LeadField[]).map((x) => x.Attribute);
    expect(attrs).toContain('mx_Seniority');
    expect(attrs).not.toContain('mx_Function');
  });
});

describe('caching and failure modes', () => {
  it('fetches the schema once per 5 minutes, not once per lead', async () => {
    await createOrUpdateLead([f('EmailAddress', 'a@x.com')]);
    await createOrUpdateLead([f('EmailAddress', 'b@x.com')]);
    await bulkCreateOrUpdateLeads([[f('EmailAddress', 'c@x.com')]]);
    expect(fake.requestsTo('LeadsMetaData.Get')).toHaveLength(1);
  });

  it('if the metadata call fails the fields are sent UNCHANGED (never silently dropped)', async () => {
    fake.setFault({ match: 'LeadsMetaData.Get', times: 'forever', status: 500, body: 'metadata unavailable' });
    fake.state.config.customFields.push('mx_Seniority');
    await createOrUpdateLead([f('EmailAddress', 'a@x.com'), f('mx_Seniority', 'VP')]);
    expect((fake.requestsTo('Lead.CreateOrUpdate')[0].body as LeadField[]).some((x) => x.Attribute === 'mx_Seniority')).toBe(true);
  });

  it('an empty metadata answer disables filtering instead of dropping every custom field', async () => {
    fake.setFault({ match: 'LeadsMetaData.Get', times: 'forever', status: 200, body: [] });
    expect(await getTenantCustomFieldNames()).toBeNull();
  });

  it('standard (non-mx_) attributes are never filtered, even when absent from metadata', () => {
    const { kept, dropped } = splitUnknownCustomFields([f('EmailAddress', 'a@x.com'), f('FirstName', 'A'), f('mx_Nope', 'x')], new Set(['emailaddress']));
    expect(kept.map((x) => x.Attribute)).toEqual(['EmailAddress', 'FirstName']);
    expect(dropped).toEqual(['mx_Nope']);
  });

  it('a standard unknown attribute is still reported by LeadSquared itself (not hidden by discovery)', async () => {
    await expect(createOrUpdateLead([f('EmailAddress', 'a@x.com'), f('NotAStandardField', 'x')])).rejects.toThrow(/MXUnknownAttribute/);
  });
});
