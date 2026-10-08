/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    contact: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    emailSuppression: { upsert: vi.fn() },
    cadenceSend: { updateMany: vi.fn() },
    appSetting: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/lib/registerContact', () => ({ registerContact: vi.fn() }));
vi.mock('@/lib/leadsquared', () => ({ getLeadById: vi.fn() }));

import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { POST } from './route';

const camp = (id: string) => ({ id, name: `Webinar ${id}`, vertical: 'SaaS' });
const post = (body: unknown, qs = '') =>
  POST(new Request(`http://localhost/api/webhooks/leadsquared/activity${qs}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.campaign.findUnique).mockResolvedValue(null as any);
  vi.mocked(db.campaign.findFirst).mockResolvedValue(null as any);
  vi.mocked(db.contact.create).mockResolvedValue({ id: 'new_ct', campaignId: 'only', email: 'a@x.com' } as any);
  vi.mocked(registerContact).mockResolvedValue({ ok: true, alreadyRegistered: false, joinUrl: null, campaignName: 'W', campaignId: 'x', scheduledAt: null, queued: 0 } as any);
});

describe('LSQ webhook: campaign resolution when the payload names no webinar', () => {
  it('uses the single active webinar', async () => {
    vi.mocked(db.campaign.findMany).mockResolvedValue([camp('only')] as any);
    vi.mocked(db.contact.findFirst).mockResolvedValue(null as any);
    await post({ EmailAddress: 'a@x.com' });
    expect(db.contact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ campaignId: 'only' }) });
  });

  it('with several active webinars, picks the one the person is already a contact of', async () => {
    vi.mocked(db.campaign.findMany).mockResolvedValue([camp('newest'), camp('older')] as any);
    vi.mocked(db.contact.findFirst)
      .mockResolvedValueOnce({ campaignId: 'older' } as any) // membership lookup
      .mockResolvedValueOnce({ id: 'ct_old', campaignId: 'older', email: 'a@x.com', lsqLeadId: null } as any); // contact lookup in target
    await post({ EmailAddress: 'a@x.com' });
    expect(registerContact).toHaveBeenCalledWith('older', 'ct_old', 'leadsquared', undefined);
    expect(db.contact.create).not.toHaveBeenCalled();
  });

  it('with several active webinars and no membership, refuses to guess and says how to fix it', async () => {
    vi.mocked(db.campaign.findMany).mockResolvedValue([camp('a'), camp('b')] as any);
    vi.mocked(db.contact.findFirst).mockResolvedValue(null as any);
    const res = await post({ EmailAddress: 'stranger@x.com' });
    const json = await res.json();
    expect(registerContact).not.toHaveBeenCalled();
    expect(db.contact.create).not.toHaveBeenCalled();
    expect(json.results[0]).toMatchObject({ status: 'skipped-not-found' });
    expect(json.results[0].detail).toMatch(/campaignId/);
  });

  it('an explicit ?campaignId= always wins and skips the fallback entirely', async () => {
    vi.mocked(db.campaign.findUnique).mockResolvedValue(camp('chosen') as any);
    vi.mocked(db.contact.findFirst).mockResolvedValue({ id: 'ct', campaignId: 'chosen', email: 'a@x.com', lsqLeadId: null } as any);
    await post({ EmailAddress: 'a@x.com' }, '?campaignId=chosen');
    expect(db.campaign.findMany).not.toHaveBeenCalled();
    expect(registerContact).toHaveBeenCalledWith('chosen', 'ct', 'leadsquared', undefined);
  });

  it('with no active webinar at all, falls back to the newest campaign (legacy behaviour)', async () => {
    vi.mocked(db.campaign.findMany).mockResolvedValue([] as any);
    vi.mocked(db.campaign.findFirst).mockResolvedValue(camp('legacy') as any);
    vi.mocked(db.contact.findFirst).mockResolvedValue(null as any);
    vi.mocked(db.contact.create).mockResolvedValue({ id: 'c2', campaignId: 'legacy', email: 'a@x.com' } as any);
    await post({ EmailAddress: 'a@x.com' });
    expect(db.contact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ campaignId: 'legacy' }) });
  });
});
