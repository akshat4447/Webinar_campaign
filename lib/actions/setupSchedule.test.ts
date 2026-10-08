/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateCampaignSchedule (lib/actions/setup.ts) is the real, non-destructive
// reschedule path — changing the webinar date recomputes dueAt for queued,
// webinar-anchored sends from their configured offset rather than wiping
// scores/drafts/sends the way editing the campaign's topic does. Nothing
// tested this before; a regression here (e.g. touching sent/failed rows, or
// shifting launch-anchored steps that shouldn't move) would silently corrupt
// a live cadence's timing.

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Kolkata', status: 'draft', cadenceStatus: 'not_started' }) },
    cadenceStep: { findMany: vi.fn() },
    cadenceSend: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

vi.mock('@/lib/revalidate', () => ({
  revalidateCampaign: vi.fn(),
}));

import { db } from '@/lib/db';
import { updateCampaignSchedule } from './setup';

describe('updateCampaignSchedule reschedule (lib/actions/setup.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.update).mockResolvedValue({} as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  it('shifts queued webinar-anchored sends to the new date + their configured offset', async () => {
    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([
      { key: 't1d', offsetValue: -1, offsetUnit: 'days' },
      { key: 't1h', offsetValue: -1, offsetUnit: 'hours' },
    ] as any);

    const res = await updateCampaignSchedule('camp_1', '2026-11-05T10:00');

    expect(res.ok).toBe(true);
    expect(db.cadenceStep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ anchor: 'webinar' }) })
    );

    const calls = vi.mocked(db.cadenceSend.updateMany).mock.calls;
    expect(calls).toHaveLength(2);

    const t1dCall = calls.find(([args]: any) => args.where.stepKey === 't1d')![0] as any;
    expect(t1dCall.where.status).toBe('queued');
    expect(t1dCall.data.dueAt.toISOString().slice(0, 10)).toBe('2026-11-04'); // 1 day before Nov 5

    const t1hCall = calls.find(([args]: any) => args.where.stepKey === 't1h')![0] as any;
    // 10:00 is wall-clock time in the webinar's zone (IST), so the webinar starts at 04:30Z and t-1h is 03:30Z.
    expect(t1hCall.data.dueAt.toISOString()).toBe('2026-11-05T03:30:00.000Z');
  });

  it('only ever targets status: "queued" — never touches sent or failed sends', async () => {
    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([
      { key: 't3', offsetValue: -3, offsetUnit: 'days' },
    ] as any);

    await updateCampaignSchedule('camp_1', '2026-11-05T10:00');

    const [args] = vi.mocked(db.cadenceSend.updateMany).mock.calls[0] as any;
    expect(args.where.status).toBe('queued');
  });

  it('does not touch CadenceSend at all when there are no webinar-anchored steps', async () => {
    vi.mocked(db.cadenceStep.findMany).mockResolvedValue([] as any);

    const res = await updateCampaignSchedule('camp_1', '2026-11-05T10:00');

    expect(res.ok).toBe(true);
    expect(db.cadenceSend.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an unparseable date without touching the database', async () => {
    const res = await updateCampaignSchedule('camp_1', 'not-a-real-date');

    expect(res.ok).toBe(false);
    expect(db.campaign.update).not.toHaveBeenCalled();
  });

  it('clears the schedule when given an empty date', async () => {
    const res = await updateCampaignSchedule('camp_1', '');

    expect(res.ok).toBe(true);
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: { scheduledAt: null, date: 'Not scheduled yet' },
    });
    // Clearing the date short-circuits before the webinar-anchored reshift logic.
    expect(db.cadenceStep.findMany).not.toHaveBeenCalled();
  });
});
