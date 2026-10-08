import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    appSetting: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    campaign: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn().mockImplementation((id: string, key: string) => {
    if (id === 'lsq' && key === 'host') return Promise.resolve('https://api-in21.leadsquared.com/v2/');
    if (id === 'lsq' && key === 'senderEmail') return Promise.resolve('and.78101@lsqdev.in');
    return Promise.resolve('');
  }),
}));

vi.mock('@/lib/leadsquared', () => ({
  getLists: vi.fn(),
  getLeadsInList: vi.fn(),
}));

import * as lsq from '@/lib/leadsquared';
import { fetchLsqListsAction, getStaticListsAction } from './setup';

describe('fetchLsqListsAction smart organization & tenant resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves tenant host, sender email, and prioritizes lists with active members above empty system lists', async () => {
    vi.mocked(lsq.getLists).mockResolvedValue([
      { ListId: 'l-starred-0', ListName: 'Starred Leads', ListDescription: '', ListType: 'static', MemberCount: 0 },
      { ListId: 'l-starred-1', ListName: 'Starred Leads', ListDescription: '', ListType: 'static', MemberCount: 0 },
      { ListId: 'l-all-0', ListName: 'All Contacts', ListDescription: '', ListType: 'dynamic', MemberCount: 0 },
      { ListId: 'l-old-webinar', ListName: 'Old Webinar Campaign Agent', ListDescription: '', ListType: 'static', MemberCount: 0 },
      { ListId: 'l-active-students', ListName: 'Student lists with act', ListDescription: '', ListType: 'dynamic', MemberCount: 7 },
      { ListId: 'l-active-parents', ListName: 'Parent List', ListDescription: '', ListType: 'static', MemberCount: 4 },
      { ListId: 'l-custom-leads', ListName: 'VIP Leads', ListDescription: '', ListType: 'static', MemberCount: 15 },
    ]);

    const res = await fetchLsqListsAction();

    expect(res.ok).toBe(true);
    expect(res.tenantHost).toBe('api-in21.leadsquared.com');
    expect(res.senderEmail).toBe('and.78101@lsqdev.in');
    expect(res.lists).toHaveLength(7);

    // Lists with members should be sorted by member count descending:
    // VIP Leads (15) -> Student lists with act (7) -> Parent List (4)
    expect(res.lists[0].ListName).toBe('VIP Leads');
    expect(res.lists[0].MemberCount).toBe(15);
    expect(res.lists[1].ListName).toBe('Student lists with act');
    expect(res.lists[1].MemberCount).toBe(7);
    expect(res.lists[2].ListName).toBe('Parent List');
    expect(res.lists[2].MemberCount).toBe(4);

    // Custom 0-member lists come next
    expect(res.lists[3].ListName).toBe('Old Webinar Campaign Agent');

    // System 0-member lists come at the very bottom
    const lastLists = res.lists.slice(4).map((l) => l.ListName);
    expect(lastLists).toContain('Starred Leads');
    expect(lastLists).toContain('All Contacts');
  });

  it('sorts static lists by member count descending in getStaticListsAction', async () => {
    vi.mocked(lsq.getLists).mockResolvedValue([
      { ListId: 's-0', ListName: 'Empty List', ListDescription: '', ListType: 'static', MemberCount: 0 },
      { ListId: 's-10', ListName: 'Big List', ListDescription: '', ListType: 'static', MemberCount: 10 },
      { ListId: 'd-5', ListName: 'Dynamic List', ListDescription: '', ListType: 'dynamic', MemberCount: 5 },
      { ListId: 's-3', ListName: 'Medium List', ListDescription: '', ListType: 'static', MemberCount: 3 },
    ]);

    const res = await getStaticListsAction();
    expect(res.ok).toBe(true);
    expect(res.lists).toEqual([
      { id: 's-10', name: 'Big List', members: 10 },
      { id: 's-3', name: 'Medium List', members: 3 },
      { id: 's-0', name: 'Empty List', members: 0 },
    ]);
  });
});
