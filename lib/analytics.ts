import { db } from '@/lib/db';
import { getPersonaLearning, type PersonaLearningRow } from '@/lib/personaLearning';
import { parseLegacyWebinarDate } from '@/lib/campaignDate';
import { formatAttendanceRate } from '@/lib/attendanceRate';
import { INVITE_STEP_KEYS } from '@/lib/cadenceStepKinds';
import {
  bucketDatedCounts,
  campaignRangeWhere,
  countDelta,
  fmtPct,
  pct,
  ratioDelta,
  windowsFor,
  DASH,
  type DashboardRange,
  type DatedCount,
  type TrendPoint,
} from '@/lib/analyticsMath';

/**
 * Cross-campaign reporting for `/dashboard` — everything here reads across
 * every campaign, unlike a campaign's own Overview tab which is scoped to one.
 */

export type { DashboardRange, TrendPoint };
export { DASH };

export interface DashboardKpi {
  label: string;
  value: string;
  delta: number | null;
  /** How to read `delta` — a percentage-point shift for a rate, a relative
   *  percent change for a count. */
  deltaKind: 'points' | 'relative';
}

export async function getDashboardKpis(range: DashboardRange, now = new Date()): Promise<DashboardKpi[]> {
  const { start, prevStart, prevEnd } = windowsFor(range, now);

  async function periodStats(from: Date | null, to: Date | null) {
    const registeredWhere = from ? { registeredAt: { gte: from, ...(to ? { lt: to } : {}) } } : { registeredAt: { not: null } };
    const contactWhere = from ? { createdAt: { gte: from, ...(to ? { lt: to } : {}) } } : {};
    const sentWhere = from ? { status: 'sent', sentAt: { gte: from, ...(to ? { lt: to } : {}) } } : { status: 'sent' };
    const invitedWhere = { ...sentWhere, stepKey: { in: INVITE_STEP_KEYS } };
    const campaignWhere = campaignRangeWhere(from, to);

    const [registrations, delivered, invited, scoredContacts, approvedContacts, attendedContacts, campaigns, demoAgg] = await Promise.all([
      db.contact.count({ where: registeredWhere }),
      db.cadenceSend.count({ where: sentWhere }),
      db.cadenceSend.groupBy({ by: ['contactId'], where: invitedWhere }).then(rows => rows.length),
      db.contact.count({ where: { ...contactWhere, score: { not: null } } }),
      db.contact.count({ where: { ...contactWhere, score: { not: null }, approved: true } }),
      db.contact.count({ where: { ...registeredWhere, attended: true } }),
      db.campaign.count({ where: campaignWhere }),
      db.campaign.aggregate({ where: campaignWhere, _sum: { demoRequests: true } }),
    ]);
    return { registrations, delivered, invited, approvalRate: pct(approvedContacts, scoredContacts), attendanceRate: pct(attendedContacts, registrations), regRate: pct(registrations, invited), webinars: campaigns, demoRequests: demoAgg._sum.demoRequests ?? 0 };
  }

  // Independent windows — no reason to wait for one before starting the other.
  const [current, previous] = await Promise.all([
    periodStats(start, now),
    prevStart ? periodStats(prevStart, prevEnd) : Promise.resolve(null),
  ]);

  return [
    { label: 'Webinars in range', value: current.webinars.toLocaleString(), delta: countDelta(current.webinars, previous?.webinars ?? null), deltaKind: 'relative' },
    { label: 'Invites sent', value: current.invited.toLocaleString(), delta: countDelta(current.invited, previous?.invited ?? null), deltaKind: 'relative' },
    { label: 'Registrations', value: current.registrations.toLocaleString(), delta: countDelta(current.registrations, previous?.registrations ?? null), deltaKind: 'relative' },
    { label: 'Avg. reg. rate', value: fmtPct(current.regRate), delta: ratioDelta(current.regRate, previous?.regRate ?? null), deltaKind: 'points' },
    { label: 'Messages dispatched', value: current.delivered.toLocaleString(), delta: countDelta(current.delivered, previous?.delivered ?? null), deltaKind: 'relative' },
    { label: 'Approval rate', value: fmtPct(current.approvalRate), delta: ratioDelta(current.approvalRate, previous?.approvalRate ?? null), deltaKind: 'points' },
    { label: 'Attendance rate', value: fmtPct(current.attendanceRate), delta: ratioDelta(current.attendanceRate, previous?.attendanceRate ?? null), deltaKind: 'points' },
    { label: 'Demo requests', value: current.demoRequests.toLocaleString(), delta: countDelta(current.demoRequests, previous?.demoRequests ?? null), deltaKind: 'relative' },
  ];
}

/**
 * Strictly month-wise bucketing across every dashboard range as requested.
 * For '30d', '90d', and '6m', displays the trailing 6 calendar months (pinned to 1st of month UTC)
 * so operators see a continuous, meaningful month-over-month trajectory with full monthly data.
 * For 'all', displays all calendar months across history (minimum 6 months).
 */
export async function getRegistrationsTrend(range: DashboardRange, now = new Date()): Promise<TrendPoint[]> {
  const unit: 'day' | 'week' | 'month' = 'month';

  let start: Date | null = null;
  if (range !== 'all') {
    // Trailing 6 calendar months pinned to 1st of month UTC
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1, 0, 0, 0, 0));
  }

  const rows = await db.$queryRaw<{ date: Date; count: bigint }[]>`SELECT date_trunc('month', "registeredAt") AS date, count(*) AS count FROM "Contact" WHERE "registeredAt" IS NOT NULL AND (${start}::timestamp IS NULL OR "registeredAt" >= ${start}) AND "registeredAt" < ${now} GROUP BY 1 ORDER BY 1`;
  const items: DatedCount[] = rows.map(r => ({ date: r.date, count: Number(r.count) }));

  let earliest = start;
  if (!earliest) {
    if (items.length > 0) {
      earliest = items.reduce((min, cur) => (cur.date < min ? cur.date : min), items[0].date);
    } else {
      earliest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1, 0, 0, 0, 0));
    }
  }

  return bucketDatedCounts(items, earliest, now, unit);
}

export interface ChannelRow {
  label: string;
  count: number;
  pct: number;
}

const SOURCE_LABEL: Record<string, string> = {
  one_click: 'One-click link',
  linkedin: 'LinkedIn',
  leadsquared: 'LeadSquared CRM',
  netcore: 'Netcore Cloud',
  netcore_click: 'Netcore Cloud',
  manual: 'Manual',
  import: 'Import',
};

export async function getRegistrationsByChannel(range: DashboardRange, now = new Date()): Promise<ChannelRow[]> {
  const { start } = windowsFor(range, now);
  const rows = await db.contact.groupBy({ by: ['registrationSource'], where: { registeredAt: start ? { gte: start, lt: now } : { not: null } }, _count: { _all: true } });
  const total = rows.reduce((n, r) => n + r._count._all, 0);
  return rows.map(r => ({ label: SOURCE_LABEL[r.registrationSource || ''] || r.registrationSource || 'Unknown source', count: r._count._all, pct: total ? Math.round(r._count._all / total * 100) : 0 })).sort((a,b) => b.count - a.count);

}

export interface WebinarRow {
  id: string;
  name: string;
  date: string;
  timestamp?: number;
  status: string;
  registered: number;
  attendanceRate: string;
  demoRequests: number;
}

export interface WebinarsInRangeResult {
  rows: WebinarRow[];
  /** True count of webinars matching the range, independent of `take` — lets
   *  callers show "N of TOTAL" without TOTAL silently meaning "capped at 20". */
  totalCount: number;
}

export async function getWebinarsInRange(range: DashboardRange, now = new Date(), take = 20): Promise<WebinarsInRangeResult> {
  const { start } = windowsFor(range, now);
  const where = campaignRangeWhere(start, now);

  const [campaigns, totalCount] = await Promise.all([
    db.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, name: true, date: true, scheduledAt: true, createdAt: true, status: true, registrations: true, attendance: true, demoRequests: true },
    }),
    db.campaign.count({ where }),
  ]);

  // Two grouped queries for the whole table rather than two per row — this was
  // 40 sequential round trips for the default take of 20.
  const campaignIds = campaigns.map((c) => c.id);
  const [registeredGroups, attendedGroups] = campaignIds.length
    ? await Promise.all([
        db.contact.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: campaignIds }, registeredAt: { not: null } },
          _count: { _all: true },
        }),
        db.contact.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: campaignIds }, attended: true },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const registeredById = new Map(registeredGroups.map((r) => [r.campaignId, r._count._all]));
  const attendedById = new Map(attendedGroups.map((r) => [r.campaignId, r._count._all]));

  const rows = campaigns.map((c) => {
    const totalReg = registeredById.get(c.id) ?? 0;
    const attendedCount = attendedById.get(c.id) ?? 0;
    const campDate = c.scheduledAt ?? parseLegacyWebinarDate(c.date) ?? c.createdAt;
    return {
      id: c.id,
      name: c.name,
      date: c.date,
      timestamp: campDate.getTime(),
      status: c.status,
      registered: totalReg,
      // Shared definition — see lib/attendanceRate.ts.
      attendanceRate: formatAttendanceRate(attendedCount, totalReg),
      demoRequests: c.demoRequests ?? 0,
    };
  });

  return { rows, totalCount };
}

export type { PersonaLearningRow };
export { getPersonaLearning };

export interface LearningRow {
  dimension: 'Vertical' | 'Source';
  label: string;
  pct: number;
  sampleSize: number;
}

const MIN_SAMPLE = 3;
const MAX_LEARNING_ROWS = 6;

/**
 * Track record across dimensions other than persona (which has its own
 * dedicated table, `getPersonaLearning`) — vertical and lead source. Same
 * honesty rule: a dimension needs at least `MIN_SAMPLE` scored contacts
 * before its rate is shown, so a one-contact vertical can't look like a
 * 100%-or-0% signal.
 *
 * Bounded by the dashboard's own range selector rather than reading every
 * scored contact ever, the same window `getDashboardKpis` and friends use —
 * `all` intentionally leaves it unfiltered, matching how `all` behaves
 * elsewhere on this page.
 */
export async function getCrossCampaignLearnings(range: DashboardRange, now = new Date()): Promise<LearningRow[]> {
  const { start } = windowsFor(range, now);
  const contactWhere = start ? { createdAt: { gte: start } } : {};
  const contacts = await db.contact.findMany({
    where: { ...contactWhere, score: { not: null } },
    select: { vertical: true, source: true, approved: true },
  });

  function rank(dimension: LearningRow['dimension'], key: (c: (typeof contacts)[number]) => string): LearningRow[] {
    const byKey = new Map<string, { approved: number; total: number }>();
    for (const c of contacts) {
      const label = key(c);
      const bucket = byKey.get(label) ?? { approved: 0, total: 0 };
      bucket.total++;
      if (c.approved) bucket.approved++;
      byKey.set(label, bucket);
    }
    return [...byKey.entries()]
      .filter(([, v]) => v.total >= MIN_SAMPLE)
      .map(([label, v]) => ({ dimension, label, pct: Math.round((v.approved / v.total) * 100), sampleSize: v.total }));
  }

  return [...rank('Vertical', (c) => c.vertical), ...rank('Source', (c) => c.source)]
    .sort((a, b) => b.pct - a.pct || b.sampleSize - a.sampleSize)
    .slice(0, MAX_LEARNING_ROWS);
}
