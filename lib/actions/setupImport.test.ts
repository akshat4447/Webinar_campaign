import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {findUnique: vi.fn().mockResolvedValue({id:'c1',status:'draft',cadenceStatus:'not_started'})},
    contact: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockImplementation(({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve(data);
      }),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLogEntry: { createMany: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)({}) : Promise.all(arg as unknown[]))),
  },
}));
vi.mock('@/lib/leadSync', () => ({ syncContactsToLeadSquared: vi.fn().mockResolvedValue({ leadsCreated: 0, leadsUpdated: 0 }) }));
vi.mock('@/lib/attentionItems', () => ({ upsertAttentionItem: vi.fn(), resolveAttentionItems: vi.fn() }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/leadsquared', () => ({ getLists: vi.fn(), getLeadsInList: vi.fn() }));
vi.mock('@/lib/integrationConfig', () => ({ resolveIntegrationField: vi.fn().mockResolvedValue('') }));
vi.mock('@/lib/speakersServer', () => ({ syncSpeakersForCampaign: vi.fn() }));

import { importCsvAction } from './setup';

function fd(csv: string) {
  const f = new FormData();
  f.set('file', new File([csv], 'contacts.csv', { type: 'text/csv' }));
  return f;
}

beforeEach(() => {
  created.length = 0;
});

describe('importCsvAction accounting and row issues', () => {
  const csv = [
    'Name,Email,Company,Title',
    'Asha Rao,asha@acme.com,Acme,VP Sales',
    'Asha Rao,asha@acme.com,Acme,VP Sales', // duplicate
    'Bad Email,not-an-email,Beta,CTO', // invalid email
    ',nameless@gamma.com,Gamma,Head of Ops', // no name
    ',,,', // blank (dropped by the parser)
  ].join('\n');

  it('reports imported = rows minus duplicates and blanks, so the totals agree', async () => {
    const res = await importCsvAction('c1', fd(csv));
    expect(res.ok).toBe(true);
    // The CSV parser already drops fully blank rows; skippedBlank covers any it lets through.
    expect(res.rowCount).toBe(4);
    expect(res.skippedBlank).toBe(0);
    expect(res.dupes).toBe(1);
    expect(res.imported).toBe(3);
    expect((res.imported ?? 0) + (res.dupes ?? 0) + (res.skippedBlank ?? 0)).toBe(res.rowCount);
  });

  it('keeps an invalid email out of the email field and flags the row', async () => {
    const res = await importCsvAction('c1', fd(csv));
    const bad = created.find((c) => c.name === 'Bad Email');
    expect(bad?.email === null || bad?.email === '').toBe(true);
    expect(bad?.missingInfo).toBe(true);
    const issue = res.issues?.find((i) => i.kind === 'invalid_email');
    expect(issue?.row).toBe(4);
    expect(issue?.message).toContain('not-an-email');
  });

  it('names a nameless row after its email and flags it', async () => {
    const res = await importCsvAction('c1', fd(csv));
    expect(created.some((c) => c.name === 'nameless')).toBe(true);
    expect(res.issues?.some((i) => i.kind === 'missing_name' && i.row === 5)).toBe(true);
  });
});
