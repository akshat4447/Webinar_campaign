import { db } from '@/lib/db';
import { getPersonaLearning, type PersonaLearningRow } from '@/lib/personaLearning';
import {
  bucketDates,
  campaignRangeWhere,
  countDelta,
  fmtPct,
  pct,
  ratioDelta,
  windowsFor,
  DASH,
  type DashboardRange,
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

const INVITE_STEP_KEYS = ['invite', 'smsInvite', 'waInvite'];

export async function getDashboardKpis(range: DashboardRange, now = new Date()): Promise<DashboardKpi[]> {
  const { start, prevStart, prevEnd } = windowsFor(range, now);

  async function periodStats(from: Date | null, to: Date | null) {
    const registeredWhere = from ? { registeredAt: { gte: from, ...(to ? { lt: to } : {}) } } : { registeredAt: { not: null } };
    const contactWhere = from ? { createdAt: { gte: from, ...(to ? { lt: to } : {}) } } : {};
    const sentWhere = from ? { status: 'sent', sentAt: { gte: from, ...(to ? { lt: to } : {}) } } : { status: 'sent' };
    const invitedWhere = { ...sentWhere, stepKey: { in: INVITE_STEP_KEYS } };
    const campaignWhere = campaignRangeWhere(from, to);

    const [registrations, delivered, invited, scoredContacts, approvedContacts, attendedContacts, webinars, demoAgg] = await Promise.all([
      db.contact.count({ where: registeredWhere }),
      db.cadenceSend.count({ where: sentWhere }),
      db.cadenceSend.count({ where: invitedWhere }),
      db.contact.count({ where: { ...contactWhere, score: { not: null } } }),
      db.contact.count({ where: { ...contactWhere, approved: true } }),
      db.contact.count({ where: { ...contactWhere, attended: true } }),
      db.campaign.count({ where: campaignWhere }),
      db.campaign.aggregate({ where: campaignWhere, _sum: { demoRequests: true } }),
    ]);

    return {
      registrations,
      delivered,
      invited,
      approvalRate: pct(approvedContacts, scoredContacts),
      attendanceRate: pct(attendedContacts, registrations),
      regRate: pct(registrations, invited),
      webinars,
      // Neither Zoom nor the CRM carries a "requested a demo" signal (see
      // lib/postEvent.ts) — demoRequests is a manually-set per-campaign
      // number, so this is a sum of whatever's on record, not a live count.
      demoRequests: demoAgg._sum.demoRequests ?? 0,
    };
  }

  const current = await periodStats(start, now);
  const previous = prevStart ? await periodStats(prevStart, prevEnd) : null;

  return [
    { label: 'Webinars in range', value: current.webinars.toLocaleString(), delta: countDelta(current.webinars, previous?.webinars ?? null), deltaKind: 'relative' },
    { label: 'Invites sent', value: current.invited.toLocaleString(), delta: countDelta(current.invited, previous?.invited ?? null), deltaKind: 'relative' },
    { label: 'Registrations', value: current.registrations.toLocaleString(), delta: countDelta(current.registrations, previous?.registrations ?? null), deltaKind: 'relative' },
    { label: 'Avg. reg. rate', value: fmtPct(current.regRate), delta: ratioDelta(current.regRate, previous?.regRate ?? null), deltaKind: 'points' },
    { label: 'Messages delivered', value: current.delivered.toLocaleString(), delta: countDelta(current.delivered, previous?.delivered ?? null), deltaKind: 'relative' },
    { label: 'Approval rate', value: fmtPct(current.approvalRate), delta: ratioDelta(current.approvalRate, previous?.approvalRate ?? null), deltaKind: 'points' },
    { label: 'Attendance rate', value: fmtPct(current.attendanceRate), delta: ratioDelta(current.attendanceRate, previous?.attendanceRate ?? null), deltaKind: 'points' },
    { label: 'Demo requests', value: current.demoRequests.toLocaleString(), delta: countDelta(current.demoRequests, previous?.demoRequests ?? null), deltaKind: 'relative' },
  ];
}

/** Buckets registrations into a chart-friendly series — daily for 30d (finer
 *  detail matters at that scale), weekly for 90d, monthly for 6m/all (daily
 *  buckets over 6 months would be an unreadable 180 bars). */
export async function getRegistrationsTrend(range: DashboardRange, now = new Date()): Promise<TrendPoint[]> {
  const { start } = windowsFor(range, now);
  const unit: 'day' | 'week' | 'month' = range === '30d' ? 'day' : range === '90d' ? 'week' : 'month';

  const earliest = start ?? (await db.contact.findFirst({ where: { registeredAt: { not: null } }, orderBy: { registeredAt: 'asc' }, select: { registeredAt: true } }))?.registeredAt ?? now;

  const rows = await db.contact.findMany({
    where: { registeredAt: { gte: earliest } },
    select: { registeredAt: true },
  });

  return bucketDates(
    rows.map((r) => r.registeredAt!),
    earliest,
    now,
    unit
  );
}

export interface ChannelRow {
  label: string;
  count: number;
  pct: number;
}

const SOURCE_LABEL: Record<string, string> = {
  one_click: 'One-click link',
  linkedin: 'LinkedIn',
  manual: 'Manual',
  import: 'Import',
};

export async function getRegistrationsByChannel(range: DashboardRange, now = new Date()): Promise<ChannelRow[]> {
  const { start } = windowsFor(range, now);
  const rows = await db.contact.groupBy({
    by: ['registrationSource'],
    where: { registeredAt: start ? { gte: start } : { not: null } },
    _count: true,
  });

  const total = rows.reduce((sum, r) => sum + r._count, 0);
  return rows
    .map((r) => ({
      label: SOURCE_LABEL[r.registrationSource ?? ''] ?? 'Unknown',
      count: r._count,
      pct: pct(r._count, total) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

const INVITE_CHANNEL_LABEL: Record<string, string> = {
  invite: 'Email',
  smsInvite: 'SMS',
  waInvite: 'WhatsApp',
};

/**
 * A different axis than `getRegistrationsByChannel` above: that one groups by
 * *how* someone registered (one-click link, a LinkedIn form, manual entry,
 * a CSV import) — this groups by *which invite* actually reached them
 * (email/SMS/WhatsApp cadence step, or LinkedIn's own registration form,
 * which never goes through a CadenceSend at all). A contact invited on more
 * than one channel counts under each, same convention as
 * lib/attendeeChannels.ts's attendee breakdown.
 */
export async function getRegistrationsByInviteChannel(range: DashboardRange, now = new Date()): Promise<ChannelRow[]> {
  const { start } = windowsFor(range, now);
  const registered = await db.contact.findMany({
    where: { registeredAt: start ? { gte: start } : { not: null } },
    select: { id: true, registrationSource: true },
  });
  if (registered.length === 0) return [];

  const total = registered.length;
  const linkedinCount = registered.filter((c) => c.registrationSource === 'linkedin').length;
  const otherIds = registered.filter((c) => c.registrationSource !== 'linkedin').map((c) => c.id);

  const sends = otherIds.length
    ? await db.cadenceSend.findMany({
        where: { contactId: { in: otherIds }, stepKey: { in: Object.keys(INVITE_CHANNEL_LABEL) }, status: 'sent' },
        select: { contactId: true, stepKey: true },
      })
    : [];

  const byChannel = new Map<string, Set<string>>();
  for (const s of sends) {
    const label = INVITE_CHANNEL_LABEL[s.stepKey];
    const set = byChannel.get(label) ?? new Set<string>();
    set.add(s.contactId);
    byChannel.set(label, set);
  }

  return [...Object.values(INVITE_CHANNEL_LABEL), 'LinkedIn (assisted)']
    .filter((label, i, arr) => arr.indexOf(label) === i)
    .map((label) => {
      const count = label === 'LinkedIn (assisted)' ? linkedinCount : (byChannel.get(label)?.size ?? 0);
      return { label, count, pct: pct(count, total) ?? 0 };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface WebinarRow {
  id: string;
  name: string;
  date: string;
  status: string;
  registered: number;
  attendanceRate: string;
  demoRequests: number;
}

export async function getWebinarsInRange(range: DashboardRange, now = new Date(), take = 20): Promise<WebinarRow[]> {
  const { start } = windowsFor(range, now);
  const where = campaignRangeWhere(start, now);

  const campaigns = await db.campaign.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, name: true, date: true, status: true, registrations: true, attendance: true, demoRequests: true },
  });

  return Promise.all(
    campaigns.map(async (c) => {
      const [registeredCount, approvedCount, attendedCount] = await Promise.all([
        db.contact.count({ where: { campaignId: c.id, registeredAt: { not: null } } }),
        db.contact.count({ where: { campaignId: c.id, approved: true } }),
        db.contact.count({ where: { campaignId: c.id, attended: true } }),
      ]);
      const liveRate = pct(attendedCount, approvedCount);
      return {
        id: c.id,
        name: c.name,
        date: c.date,
        status: c.status,
        registered: c.registrations ?? registeredCount,
        attendanceRate: liveRate !== null ? fmtPct(liveRate) : c.attendance ?? DASH,
        demoRequests: c.demoRequests ?? 0,
      };
    })
  );
}

export type { PersonaLearningRow };
export { getPersonaLearning };

const PERSONA_MIN_SAMPLE = 3;
const PERSONA_MAX_ROWS = 6;

/**
 * A different question than `getPersonaLearning` (which asks "of scored
 * contacts, which persona approves best"): this asks "of contacts actually
 * invited, which persona registers best" — real computed registration rate
 * by seniority + function, not a narrative claim. "Invited" means received
 * at least one sent invite-step send; a persona with no invited contacts
 * yet just doesn't appear, same honesty rule as every other learning panel.
 */
export async function getPersonaRegistrationRate(): Promise<PersonaLearningRow[]> {
  const invitedSends = await db.cadenceSend.findMany({
    where: { stepKey: { in: INVITE_STEP_KEYS }, status: 'sent' },
    select: { contactId: true },
    distinct: ['contactId'],
  });
  if (invitedSends.length === 0) return [];

  const invitedIds = invitedSends.map((s) => s.contactId);
  const contacts = await db.contact.findMany({
    where: { id: { in: invitedIds } },
    select: { seniority: true, function: true, registeredAt: true },
  });

  const byPersona = new Map<string, { registered: number; total: number }>();
  for (const c of contacts) {
    const label = `${c.seniority}-level, ${c.function}`;
    const bucket = byPersona.get(label) ?? { registered: 0, total: 0 };
    bucket.total++;
    if (c.registeredAt) bucket.registered++;
    byPersona.set(label, bucket);
  }

  return [...byPersona.entries()]
    .filter(([, v]) => v.total >= PERSONA_MIN_SAMPLE)
    .map(([label, v]) => ({ label, pct: Math.round((v.registered / v.total) * 100), sampleSize: v.total }))
    .sort((a, b) => b.pct - a.pct || b.sampleSize - a.sampleSize)
    .slice(0, PERSONA_MAX_ROWS);
}

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
 */
export async function getCrossCampaignLearnings(): Promise<LearningRow[]> {
  const contacts = await db.contact.findMany({
    where: { score: { not: null } },
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
