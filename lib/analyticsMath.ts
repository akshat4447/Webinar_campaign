/**
 * Pure date/number math behind `lib/analytics.ts`, split out so it can be
 * unit-tested without pulling in Prisma (vitest has no `@/` alias, so any
 * file importing `@/lib/db` can't be reached from a test at all).
 */

export type DashboardRange = '30d' | '90d' | '6m' | 'all';

export const DASH = '—';

export function daysFor(range: DashboardRange): number | null {
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  if (range === '6m') return 182;
  return null; // all — no lower bound
}

/** Current-period start, and the immediately-preceding period of equal length
 *  for the delta comparison. `all` has no prior period to compare against. */
export function windowsFor(range: DashboardRange, now: Date): { start: Date | null; prevStart: Date | null; prevEnd: Date | null } {
  const days = daysFor(range);
  if (days === null) return { start: null, prevStart: null, prevEnd: null };
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);
  return { start, prevStart, prevEnd: start };
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function fmtPct(v: number | null): string {
  return v === null ? DASH : `${v}%`;
}

/** Percentage-point delta between two rates, rounded — null if either side has no data. */
export function ratioDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

/** Relative delta for a plain count — null if there's no prior period, or the
 *  prior period was zero (a "+∞%" delta is not a useful number to show). */
export function countDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * The Prisma `where` for "campaigns active in this range." A campaign with a
 * real `scheduledAt` is filtered on that. A campaign with none is only
 * included via its `createdAt` when it's still a draft — a fresh, unscheduled
 * draft showing up under "recent activity" is right. A completed or live
 * campaign with no `scheduledAt` has no reliable date at all (older data
 * migrated in before scheduling existed, or a seeded historical record whose
 * display date is just flavor text) — falling back to `createdAt` there would
 * count it by when the *row* was inserted, not when the webinar happened, and
 * can sweep a months-old or months-away campaign into a "last 30 days" view.
 * `null` (the `all` range) means no filtering at all. */
export function campaignRangeWhere(from: Date | null, to: Date | null) {
  if (!from) return {};
  const inRange = { gte: from, ...(to ? { lt: to } : {}) };
  return {
    OR: [{ scheduledAt: inRange }, { AND: [{ scheduledAt: null }, { status: 'draft' }, { createdAt: inRange }] }],
  };
}

export interface TrendPoint {
  label: string;
  count: number;
}

export function bucketKey(d: Date, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (unit === 'week') {
    const weekStart = new Date(d);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return weekStart.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: '2-digit' });
  }
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

/** Buckets a list of dates into a chart-friendly series. Walks every bucket in
 *  the range, not just the ones with data, so a quiet week reads as zero
 *  rather than being silently skipped. */
export function bucketDates(dates: Date[], from: Date, to: Date, unit: 'day' | 'week' | 'month'): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = bucketKey(d, unit);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const keys: string[] = [];
  const cursor = new Date(from);
  if (unit === 'month') {
    // Pin to day 1 so advancing months from e.g. Jan 31 does not overflow past Feb into March
    cursor.setDate(1);
  }
  while (cursor <= to) {
    keys.push(bucketKey(cursor, unit));
    if (unit === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else if (unit === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
  }

  return [...new Set(keys)].map((key) => ({ label: bucketLabel(key, unit), count: counts.get(key) ?? 0 }));
}
