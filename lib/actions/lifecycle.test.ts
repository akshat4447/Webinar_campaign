/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Marking a webinar completed used to write `status` alone. The send engine
// gates on `cadenceStatus`, and the completed Results view hides Control
// Center — so a "completed" campaign kept dispatching queued sends on every
// cron tick while the UI said everything was locked and offered no way to
// stop it. These tests pin the stop, the cancellation, and the deliberate
// decision not to auto-resume on reopen.

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    cadenceSend: { updateMany: vi.fn() },
    activityLogEntry: { create: vi.fn() },
  },
}));

vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));

import { db } from '@/lib/db';
import { markCampaignCompletedAction, reopenCampaignAction } from './lifecycle';

describe('markCampaignCompletedAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.update).mockResolvedValue({} as any);
    vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 0 } as any);
  });

  it('stops a running cadence, not just the status field', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({ status: 'live', cadenceStatus: 'running' } as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 7 } as any);

    const res = await markCampaignCompletedAction('camp_1');

    expect(res.ok).toBe(true);
    expect(res.cadenceStopped).toBe(true);
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: { status: 'completed', cadenceStatus: 'stopped' },
    });
  });

  it('cancels queued and in-flight sends so none can fire later', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({ status: 'live', cadenceStatus: 'running' } as any);
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 7 } as any);

    const res = await markCampaignCompletedAction('camp_1');

    expect(res.cancelledSends).toBe(7);
    const [args] = vi.mocked(db.cadenceSend.updateMany).mock.calls[0] as any;
    expect(args.where.status).toEqual({ in: ['queued', 'processing'] });
    expect(args.data.status).toBe('skipped');
  });

  it('also stops a paused cadence — paused still resumes on the next tick if restarted', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({ status: 'live', cadenceStatus: 'paused' } as any);

    await markCampaignCompletedAction('camp_1');

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp_1' },
      data: { status: 'completed', cadenceStatus: 'stopped' },
    });
  });

  it('leaves a never-launched campaign alone beyond marking it completed', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({ status: 'draft', cadenceStatus: 'not_started' } as any);

    const res = await markCampaignCompletedAction('camp_1');

    expect(res.cadenceStopped).toBe(false);
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp_1' }, data: { status: 'completed' } });
    expect(db.cadenceSend.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent — re-marking a completed campaign writes nothing', async () => {
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({ status: 'completed', cadenceStatus: 'stopped' } as any);

    const res = await markCampaignCompletedAction('camp_1');

    expect(res.ok).toBe(true);
    expect(db.campaign.update).not.toHaveBeenCalled();
    expect(db.cadenceSend.updateMany).not.toHaveBeenCalled();
  });
});

describe('reopenCampaignAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.update).mockResolvedValue({} as any);
    vi.mocked(db.activityLogEntry.create).mockResolvedValue({} as any);
  });

  it('restores live status but deliberately does not resume the cadence', async () => {
    await reopenCampaignAction('camp_1');

    // Reopening usually happens days later, when every queued send is long
    // overdue — auto-resuming would blast the whole backlog out at once.
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp_1' }, data: { status: 'live' } });
  });
});
