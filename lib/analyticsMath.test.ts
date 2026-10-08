import { describe, it, expect } from 'vitest';
import { bucketDatedCounts, bucketDates, campaignRangeWhere, countDelta, daysFor, fmtPct, pct, ratioDelta, windowsFor, type DatedCount } from './analyticsMath';

describe('pct / fmtPct', () => {
  it('rounds a normal ratio to the nearest percent', () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(50, 200)).toBe(25);
  });

  it('returns null — not NaN or Infinity — when whole is zero or negative', () => {
    expect(pct(5, 0)).toBeNull();
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, -1)).toBeNull();
  });

  it('handles part being zero without special-casing it', () => {
    expect(pct(0, 10)).toBe(0);
  });

  it('fmtPct renders a dash for null and a percent string otherwise', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(33)).toBe('33%');
  });
});

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

  it('handles month progression without skipping February when starting from Jan 31', () => {
    const from = new Date('2026-01-31T12:00:00Z');
    const to = new Date('2026-03-15T12:00:00Z');
    const buckets = bucketDates([], from, to, 'month');
    // Must include Jan, Feb, and Mar — Feb must NOT be skipped due to 31-day overflow
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.label)).toEqual(['Jan 26', 'Feb 26', 'Mar 26']);
  });

  it('aggregates weighted counts correctly via bucketDatedCounts', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-05-31T00:00:00Z');
    const items: DatedCount[] = [
      { date: new Date('2026-03-15T00:00:00Z'), count: 250 },
      { date: new Date('2026-03-20T00:00:00Z'), count: 50 },
      { date: new Date('2026-05-10T00:00:00Z'), count: 120 },
    ];
    const buckets = bucketDatedCounts(items, from, to, 'month');
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.label)).toEqual(['Mar 26', 'Apr 26', 'May 26']);
    expect(buckets.map((b) => b.count)).toEqual([300, 0, 120]);
  });

  it('includes the trailing week bucket containing to date', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-09-16T12:00:00Z'); // Wednesday
    const items: DatedCount[] = [{ date: new Date('2026-09-14T00:00:00Z'), count: 5 }]; // Monday of that week
    const buckets = bucketDatedCounts(items, from, to, 'week');
    const lastBucket = buckets[buckets.length - 1];
    expect(lastBucket.count).toBe(5);
  });
});
