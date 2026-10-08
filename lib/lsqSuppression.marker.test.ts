import { describe, it, expect, vi, beforeEach } from 'vitest';

const done = new Set<string>();
vi.mock('@/lib/idempotency', () => ({
  idemKey: (ns: string, ...p: unknown[]) => `${ns}:${p.join('|')}`,
  findClaimed: vi.fn(async (keys: string[]) => new Set(keys.filter((k) => done.has(k)))),
  claimOnce: vi.fn(async (k: string) => (done.has(k) ? false : (done.add(k), true))),
}));

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), update: vi.fn() },
  contact: { findUnique: vi.fn(), update: vi.fn() },
  activityLogEntry: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));

const lsq = vi.hoisted(() => ({ getLists: vi.fn(), createEmptyList: vi.fn(), addLeadsToStaticList: vi.fn(), bulkCreateOrUpdateLeads: vi.fn() }));
vi.mock('@/lib/leadsquared', () => lsq);

import { syncContactToLsqSuppressionList, suppressionSyncKey } from './lsqSuppression';

beforeEach(() => {
  done.clear();
  vi.clearAllMocks();
  db.campaign.findUnique.mockResolvedValue({ lsqSuppressionListId: 'LIST', lsqFieldMappingTokens: null });
  db.contact.findUnique.mockResolvedValue({ id: 'ct1', name: 'Ann Lee', email: 'a@x.com', lsqLeadId: 'LEAD1' });
  lsq.addLeadsToStaticList.mockResolvedValue(undefined);
});

describe('syncContactToLsqSuppressionList done-marker', () => {
  it('writes a marker after a successful add so the reconcile sweep can skip it', async () => {
    expect(await syncContactToLsqSuppressionList('c1', 'ct1')).toBe(true);
    expect(done.has(suppressionSyncKey('c1', 'ct1'))).toBe(true);
  });

  it('skips the LeadSquared call entirely when the marker already exists', async () => {
    done.add(suppressionSyncKey('c1', 'ct1'));
    expect(await syncContactToLsqSuppressionList('c1', 'ct1')).toBe(true);
    expect(lsq.addLeadsToStaticList).not.toHaveBeenCalled();
    expect(db.activityLogEntry.create).not.toHaveBeenCalled();
  });

  it('does NOT write the marker when the add fails, so it is retried', async () => {
    lsq.addLeadsToStaticList.mockRejectedValueOnce(new Error('LSQ 503'));
    expect(await syncContactToLsqSuppressionList('c1', 'ct1')).toBe(false);
    expect(done.size).toBe(0);
  });

  it('does nothing for a campaign without a suppression list', async () => {
    db.campaign.findUnique.mockResolvedValue({ lsqSuppressionListId: null });
    expect(await syncContactToLsqSuppressionList('c1', 'ct1')).toBe(false);
    expect(lsq.addLeadsToStaticList).not.toHaveBeenCalled();
  });
});
