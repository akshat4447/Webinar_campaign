import { describe, it, expect } from 'vitest';
import { bucketDates, campaignRangeWhere, countDelta, daysFor, ratioDelta, windowsFor } from './analyticsMath';

describe('daysFor / windowsFor', () => {
  it('maps each named range to its day count, and all to no bound', () => {
    expect(daysFor('30d')).toBe(30);
    expect(daysFor('90d')).toBe(90);
    expect(daysFor('6m')).toBe(182);
    expect(daysFor('all')).toBeNull();
  });

  it('gives all no start and no prior-period window', () => {
    const w = windowsFor('all', new Date('2026-09-05'));
    expect(w.start).toBeNull();
    expect(w.prevStart).toBeNull();
    expect(w.prevEnd).toBeNull();
  });

  it('gives 30d a prior period of equal length immediately before it', () => {
    const now = new Date('2026-09-05T00:00:00Z');
    const w = windowsFor('30d', now);
    expect(w.start!.toISOString().slice(0, 10)).toBe('2026-08-06');
    expect(w.prevEnd!.getTime()).toBe(w.start!.getTime());
    expect(w.prevStart!.toISOString().slice(0, 10)).toBe('2026-07-07');
  });
});

describe('countDelta', () => {
  it('computes a relative percent change', () => {
    expect(countDelta(150, 100)).toBe(50);
    expect(countDelta(50, 100)).toBe(-50);
  });

  it('is null with no prior period, and null rather than infinite off a zero base', () => {
    expect(countDelta(10, null)).toBeNull();
    expect(countDelta(10, 0)).toBeNull();
  });
});

describe('ratioDelta', () => {
  it('is a plain point difference between two rates', () => {
    expect(ratioDelta(65, 50)).toBe(15);
    expect(ratioDelta(40, 55)).toBe(-15);
  });

  it('is null if either side has no rate to compare', () => {
    expect(ratioDelta(null, 50)).toBeNull();
    expect(ratioDelta(65, null)).toBeNull();
  });
});

describe('campaignRangeWhere', () => {
  it('has no filter at all for the all-time range', () => {
    expect(campaignRangeWhere(null, null)).toEqual({});
  });

  it('filters on scheduledAt, or createdAt but only for a still-unscheduled draft', () => {
    const from = new Date('2026-08-06');
    const where = campaignRangeWhere(from, null) as { OR: unknown[] };
    expect(where.OR).toEqual([
      { scheduledAt: { gte: from } },
      { AND: [{ scheduledAt: null }, { status: 'draft' }, { createdAt: { gte: from } }] },
    ]);
  });

  it('never matches a null-scheduledAt campaign by createdAt unless it is a draft', () => {
    const from = new Date('2026-08-06');
    const where = campaignRangeWhere(from, null) as { OR: [unknown, { AND: [unknown, { status: string }, unknown] }] };
    expect(where.OR[1].AND[1].status).toBe('draft');
  });
});

describe('bucketDates', () => {
  it('buckets by day and zero-fills days with no data', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-09-04T00:00:00Z');
    const dates = [new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T14:00:00Z'), new Date('2026-09-03T09:00:00Z')];
    const buckets = bucketDates(dates, from, to, 'day');
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.count)).toEqual([2, 0, 1, 0]);
  });

  it('buckets by month, folding every date in a month into one point', () => {
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-09-01T00:00:00Z');
    const dates = [new Date('2026-07-05'), new Date('2026-07-20'), new Date('2026-09-01')];
    const buckets = bucketDates(dates, from, to, 'month');
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.count)).toEqual([2, 0, 1]);
  });

  it('returns one zero-count bucket for an empty date list', () => {
    const from = new Date('2026-09-01');
    const to = new Date('2026-09-01');
    expect(bucketDates([], from, to, 'day')).toEqual([{ label: expect.any(String), count: 0 }]);
  });
});
