import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => {
  return {
    db: {
      campaign: {
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      contact: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((promises) => Promise.all(promises)),
    },
  };
});

vi.mock('@/lib/leadsquared', () => {
  return {
    bulkCreateOrUpdateLeads: vi.fn(),
    createEmptyList: vi.fn(),
    addLeadsToStaticList: vi.fn(),
    getLists: vi.fn(),
    LeadSquaredError: class LeadSquaredError extends Error {},
  };
});

import { db } from '@/lib/db';
import * as lsq from '@/lib/leadsquared';
import { syncContactsToLeadSquared } from './leadSync';

describe('Option 2: LeadSync Autonomous List Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT create a static list when createList is omitted or false and campaign has no lsqListId', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({
      id: 'camp-1',
      name: 'Test Campaign',
      lsqListId: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>);

    vi.mocked(db.contact.findMany).mockResolvedValueOnce([
      { id: 'c1', name: 'Alice Smith', email: 'alice@example.com', account: 'Acme', title: 'Director', lsqLeadId: null },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    vi.mocked(lsq.bulkCreateOrUpdateLeads).mockResolvedValue([
      { RowNumber: 0, LeadId: 'lead-alice-123', LeadCreated: true, LeadUpdated: false, AffectedRows: 1 },
    ]);

    const result = await syncContactsToLeadSquared('camp-1');

    // Leads are still created/upserted so they get lsqLeadId
    expect(lsq.bulkCreateOrUpdateLeads).toHaveBeenCalledTimes(1);
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lsqLeadId: 'lead-alice-123' },
    });

    // But NO list is created or updated in LSQ
    expect(lsq.createEmptyList).not.toHaveBeenCalled();
    expect(lsq.addLeadsToStaticList).not.toHaveBeenCalled();
    expect(db.campaign.update).not.toHaveBeenCalled();
    expect(result.listId).toBeNull();
    expect(result.leadsCreated).toBe(1);
  });

  it('uses existing lsqListId when campaign is already bound to an existing list', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({
      id: 'camp-2',
      name: 'Imported Webinar',
      lsqListId: 'existing-lsq-list-999',
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>);

    vi.mocked(db.contact.findMany)
      // first call: contacts to create
      .mockResolvedValueOnce([
        { id: 'c2', name: 'Bob Jones', email: 'bob@example.com', account: 'Beta', title: 'VP', lsqLeadId: 'lead-bob-456' },
      ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>)
      // second call: synced contacts with lsqLeadId
      .mockResolvedValueOnce([
        { id: 'c2', name: 'Bob Jones', email: 'bob@example.com', account: 'Beta', title: 'VP', lsqLeadId: 'lead-bob-456' },
      ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const result = await syncContactsToLeadSquared('camp-2', { createList: false });

    // NO new list is created
    expect(lsq.createEmptyList).not.toHaveBeenCalled();
    // Leads are associated with the existing bound list
    expect(lsq.addLeadsToStaticList).toHaveBeenCalledWith('existing-lsq-list-999', ['lead-bob-456']);
    expect(result.listId).toBe('existing-lsq-list-999');
  });

  it('only creates a list when createList is explicitly true', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({
      id: 'camp-3',
      name: 'Opt-in Campaign',
      lsqListId: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>);

    vi.mocked(db.contact.findMany)
      .mockResolvedValueOnce([
        { id: 'c3', name: 'Carol White', email: 'carol@example.com', account: 'Gamma', title: 'Lead', lsqLeadId: 'lead-carol-789' },
      ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>)
      .mockResolvedValueOnce([
        { id: 'c3', name: 'Carol White', email: 'carol@example.com', account: 'Gamma', title: 'Lead', lsqLeadId: 'lead-carol-789' },
      ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);


    vi.mocked(lsq.getLists).mockResolvedValue([]);
    vi.mocked(lsq.createEmptyList).mockResolvedValue('newly-created-list-111');

    const result = await syncContactsToLeadSquared('camp-3', { createList: true });

    expect(lsq.createEmptyList).toHaveBeenCalledTimes(1);
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-3' },
      data: { lsqListId: 'newly-created-list-111' },
    });
    expect(lsq.addLeadsToStaticList).toHaveBeenCalledWith('newly-created-list-111', ['lead-carol-789']);
    expect(result.listId).toBe('newly-created-list-111');
  });
});
