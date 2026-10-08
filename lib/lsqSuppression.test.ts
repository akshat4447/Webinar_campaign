import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    activityLogEntry: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/leadsquared', () => ({
  getLists: vi.fn(),
  createEmptyList: vi.fn(),
  addLeadsToStaticList: vi.fn(),
  bulkCreateOrUpdateLeads: vi.fn(),
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

import { db } from '@/lib/db';
import * as lsq from '@/lib/leadsquared';
import {
  getLeadSquaredSuppressionConfig,
  createAndAttachLsqSuppressionList,
  updateCampaignSuppressionLists,
  syncContactToLsqSuppressionList,
} from '@/lib/lsqSuppression';

describe('LeadSquared Suppression & List Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches static lists and campaign suppression configuration', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'c_test',
      lsqSuppressionListId: 'list_1',
      lsqExclusionListIds: JSON.stringify(['list_comp', 'list_vip']),
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    vi.mocked(lsq.getLists).mockResolvedValue([
      { ListId: 'list_1', ListName: 'Registered Attendees', ListType: 'Static', MemberCount: 42, ListDescription: '' },
      { ListId: 'list_comp', ListName: 'Competitors', ListType: 'Static', MemberCount: 15, ListDescription: '' },
      { ListId: 'list_dyn', ListName: 'Dynamic Leads', ListType: 'Dynamic', MemberCount: 100, ListDescription: '' },
    ]);

    vi.mocked(db.contact.count)
      .mockResolvedValueOnce(42) // registeredCount
      .mockResolvedValueOnce(40); // syncedToSuppressionCount

    const res = await getLeadSquaredSuppressionConfig('c_test');

    expect(res.ok).toBe(true);
    expect(res.suppressionListId).toBe('list_1');
    expect(res.suppressionListName).toBe('Registered Attendees');
    expect(res.exclusionListIds).toEqual(['list_comp', 'list_vip']);
    expect(res.lists).toHaveLength(2); // Only static lists
    expect(res.lists[0].id).toBe('list_1');
  });

  it('creates a new static list in LeadSquared and attaches it to campaign', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'c_test',
      name: 'AI Ops 2026',
      lsqFieldMappingTokens: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    vi.mocked(lsq.createEmptyList).mockResolvedValue('new_lsq_list_id');
    vi.mocked(db.contact.findMany).mockResolvedValue([
      { id: 'ct_1', lsqLeadId: 'lead_1', email: 'test1@acme.com', name: 'User One', registeredAt: new Date() },
      { id: 'ct_2', lsqLeadId: 'lead_2', email: 'test2@acme.com', name: 'User Two', registeredAt: new Date() },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const res = await createAndAttachLsqSuppressionList('c_test', '[Webinar] AI Ops 2026 - Registrants');

    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.listId).toBe('new_lsq_list_id');
    expect(lsq.createEmptyList).toHaveBeenCalledWith(
      '[Webinar] AI Ops 2026 - Registrants',
      expect.stringContaining('AI Ops 2026')
    );
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c_test' },
      data: { lsqSuppressionListId: 'new_lsq_list_id' },
    });
    expect(lsq.addLeadsToStaticList).toHaveBeenCalledWith('new_lsq_list_id', ['lead_1', 'lead_2']);
  });

  it('updates suppression list and exclusion list IDs', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'c_test',
      name: 'AI Ops 2026',
      lsqFieldMappingTokens: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    vi.mocked(db.contact.findMany).mockResolvedValue([
      { id: 'ct_1', lsqLeadId: 'lead_1', email: 'test1@acme.com', name: 'User One', registeredAt: new Date() },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const res = await updateCampaignSuppressionLists('c_test', 'target_list_id', ['ex_1', 'ex_2']);

    expect(res.ok).toBe(true);
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c_test' },
      data: {
        lsqSuppressionListId: 'target_list_id',
        lsqExclusionListIds: JSON.stringify(['ex_1', 'ex_2']),
      },
    });
    expect(lsq.addLeadsToStaticList).toHaveBeenCalledWith('target_list_id', ['lead_1']);
  });

  it('syncs newly registered contact to LeadSquared suppression list', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      lsqSuppressionListId: 'target_suppression_list',
      lsqFieldMappingTokens: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    vi.mocked(db.contact.findUnique).mockResolvedValue({
      id: 'ct_123',
      name: 'Rohan Bhatt',
      email: 'rohan@acme.com',
      lsqLeadId: 'lead_rohan',
    } as unknown as Awaited<ReturnType<typeof db.contact.findUnique>>);

    const ok = await syncContactToLsqSuppressionList('c_test', 'ct_123');

    expect(ok).toBe(true);
    expect(lsq.addLeadsToStaticList).toHaveBeenCalledWith('target_suppression_list', ['lead_rohan']);
    expect(db.activityLogEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        text: expect.stringContaining('Rohan Bhatt'),
      }),
    });
  });

  it('safely attaches existing static list when list name already exists in LeadSquared', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue({
      id: 'c_test',
      name: 'Cloud AI Ops',
      lsqFieldMappingTokens: null,
    } as unknown as Awaited<ReturnType<typeof db.campaign.findUnique>>);

    // Existing lists in tenant includes the duplicate name
    vi.mocked(lsq.getLists).mockResolvedValue([
      {
        ListId: 'existing_dup_list_id',
        ListName: '[Webinar] Cloud AI Ops - Registrants',
        ListType: 'Static',
        MemberCount: 10,
        ListDescription: '',
      },
    ]);

    vi.mocked(db.contact.findMany).mockResolvedValue([]);

    const res = await createAndAttachLsqSuppressionList('c_test', '[Webinar] Cloud AI Ops - Registrants');

    expect(res.ok).toBe(true);
    expect(res.listId).toBe('existing_dup_list_id');
    expect(res.reused).toBe(true);
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c_test' },
      data: { lsqSuppressionListId: 'existing_dup_list_id' },
    });
  });
});
