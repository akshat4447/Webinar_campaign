/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// processDueSends (lib/cadence.ts) is the production dispatch engine — it's
// exercised end-to-end by lib/cadenceNetcore.test.ts and
// lib/cadenceAutomationRules.test.ts, but none of those tests actually assert
// on its three concurrency/throughput safety properties: stale-claim
// recovery, daily-limit suspension, and the claim-token double-check that
// stops a losing race from processing rows another tick already won. A
// silent regression in any of these would risk a double-send or a runaway
// dispatch loop with no test failure to catch it.

vi.mock('@/lib/db', () => ({
  db: {
    campaign: { findUniqueOrThrow: vi.fn() },
    speaker: { findMany: vi.fn() },
    cadenceSend: {
      count: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/sendWindow', () => ({
  isWithinSendWindow: vi.fn().mockReturnValue(true),
}));

import { db } from '@/lib/db';
import { processDueSends } from './cadence';

describe('Cadence engine safety properties (lib/cadence.ts processDueSends)', () => {
  const mockCampaign = {
    id: 'campaign_safety_1',
    status: 'live',
    cadenceStatus: 'running',
    dailyLimit: 100,
    scheduleWindow: '09:00-18:00',
    simulatedNow: new Date('2026-09-20T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue(mockCampaign as any);
    vi.mocked(db.speaker.findMany).mockResolvedValue([] as any);
    vi.mocked(db.cadenceSend.count).mockResolvedValue(0); // sentToday / remaining, overridden per-test
    vi.mocked(db.cadenceSend.updateMany).mockResolvedValue({ count: 0 } as any);

    addReliabilityMocks(reliabilityDb);
});

  it('resets sends stuck in processing for >5 minutes back to queued before claiming new work', async () => {
    vi.mocked(db.$transaction).mockImplementation(async (cb: any) =>
      cb({
        cadenceSend: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })
    );

    await processDueSends(mockCampaign.id);

    const recoveryCall = vi.mocked(db.cadenceSend.updateMany).mock.calls.find(
      ([args]: any) => args?.data?.status === 'queued' && args?.data?.claimedAt === null
    );
    expect(recoveryCall).toBeDefined();
    const where = (recoveryCall as any)[0].where;
    expect(where.status).toBe('processing');
    expect(where.claimedAt.not).toBeNull();
    // The stale threshold must be roughly 5 minutes in the past, not "now" or "any time".
    const thresholdAgeMs = Date.now() - where.claimedAt.lte.getTime();
    expect(thresholdAgeMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
    expect(thresholdAgeMs).toBeLessThan(5 * 60 * 1000 + 60_000);
  });

  it('refuses to dispatch for a campaign marked completed, whatever cadenceStatus says', async () => {
    // markCampaignCompletedAction stops the cadence, but this is the
    // defence-in-depth half: the completed workspace hides Control Center, so
    // a cadence that slipped through here would have no reachable stop button.
    vi.mocked(db.campaign.findUniqueOrThrow).mockResolvedValue({
      ...mockCampaign,
      status: 'completed',
      cadenceStatus: 'running',
    } as any);

    const result = await processDueSends(mockCampaign.id);

    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('suspends dispatch entirely once dailyLimit is already met, without attempting to claim any sends', async () => {
    // sentToday === dailyLimit
    vi.mocked(db.cadenceSend.count).mockImplementation((async (args: any) => {
      if (args?.where?.status === 'sent') return mockCampaign.dailyLimit;
      return 3; // "remaining" count at the end, arbitrary non-zero
    }) as any);

    const result = await processDueSends(mockCampaign.id);

    expect(result.dailyLimitReached).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    // remainingBudget started at 0, so the claim loop's `while (... && remainingBudget > 0)`
    // must never run — no transaction should have been opened at all.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not process a batch it lost the claim race for (updateMany matches 0 rows)', async () => {
    // Another tick/process claimed these rows first: the candidate query finds
    // them, but the claiming updateMany (still filtered on status:'queued')
    // matches nothing because they're no longer 'queued' by the time it runs.
    vi.mocked(db.$transaction).mockImplementationOnce(async (cb: any) =>
      cb({
        cadenceSend: {
          findMany: vi.fn().mockResolvedValue([{ id: 'send_lost_race' }]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })
    );

    const result = await processDueSends(mockCampaign.id);

    // Losing the claim must short-circuit to an empty candidate list (lib/cadence.ts
    // `if (updated.count === 0) return [];`) — the outer loop then breaks rather than
    // fetching and dispatching send_lost_race, which this tick never actually won.
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(db.cadenceSend.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['send_lost_race'] } }) })
    );
  });
});

import { addReliabilityMocks } from '../test-support/reliabilityMocks';
import { db as reliabilityDb } from '@/lib/db';

vi.mock('@/lib/sendQuota', () => ({ quotaDay: (date: Date) => date.toISOString().slice(0,10), reserveSendQuota: vi.fn(async () => true), releaseSendQuota: vi.fn() }));
vi.mock('@/lib/lsqExclusions', () => ({ refreshLsqExclusions: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({ assertLaunchReady: vi.fn() }));
