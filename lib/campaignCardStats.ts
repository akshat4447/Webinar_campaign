import { db } from '@/lib/db';
import type { Campaign } from '@/lib/generated/prisma/client';
import { formatAttendanceRate } from '@/lib/attendanceRate';
import { INVITE_STEP_KEYS } from '@/lib/cadenceStepKinds';

/** Only the scalar fields these card/KPI helpers actually read — callers
 *  (the webinar list) fetch campaigns with a `select` for exactly this
 *  reason, so this must stay a subset rather than the full `Campaign` type. */
type CardStatsCampaign = Pick<Campaign, 'status' | 'invites' | 'registrations' | 'attendance' | 'demoRequests'>;
type ListKpiCampaign = Pick<Campaign, 'id' | 'status' | 'registrations' | 'attendance'> & { scheduledAt?: Date | null };

export interface CardStat {
  label: string;
  value: string | number;
}

/** Exactly three, because the card's footer is a fixed three-column grid and a
 *  variable count would leave ragged gaps between cards in the same row. */
export type CardStats = [CardStat, CardStat, CardStat];

const DASH = '—';

export interface CampaignCardCounts {
  contacts: number;
  /** Sent cadence steps whose stepKey is one of INVITE_STEP_KEYS — matches
   *  the dashboard's "Invites sent" KPI (lib/analytics.ts). This used to
   *  count every sent step (invites + reminders + follow-ups), so a campaign
   *  with reminder steps configured showed a higher "Invites sent" on its own
   *  card than the same campaign contributed to the dashboard total. */
  invitesSent: number;
  scored: number;
  approved: number;
  attended: number;
  registered: number;
}

const EMPTY_COUNTS: CampaignCardCounts = { contacts: 0, invitesSent: 0, scored: 0, approved: 0, attended: 0, registered: 0 };

/**
 * Every card figure for a whole page of campaigns, in a fixed six queries
 * regardless of how many campaigns there are.
 *
 * This replaced six per-campaign `count()` calls — 50 campaigns on the webinar
 * list meant 301 round trips before the grid could render, and it grew
 * linearly with the number of campaigns an account accumulated.
 */
export async function getCampaignCardCounts(campaignIds: string[]): Promise<Map<string, CampaignCardCounts>> {
  const byId = new Map<string, CampaignCardCounts>();
  if (campaignIds.length === 0) return byId;

  const scope = { campaignId: { in: campaignIds } };
  const [contacts, invitesSent, scored, approved, attended, registered] = await Promise.all([
    db.contact.groupBy({ by: ['campaignId'], where: scope, _count: { _all: true } }),
    db.cadenceSend.groupBy({
      by: ['campaignId', 'contactId'],
      where: { ...scope, status: 'sent', stepKey: { in: INVITE_STEP_KEYS } },
      _count: { _all: true },
    }),
    db.contact.groupBy({ by: ['campaignId'], where: { ...scope, score: { not: null } }, _count: { _all: true } }),
    db.contact.groupBy({ by: ['campaignId'], where: { ...scope, approved: true }, _count: { _all: true } }),
    db.contact.groupBy({ by: ['campaignId'], where: { ...scope, attended: true }, _count: { _all: true } }),
    db.contact.groupBy({ by: ['campaignId'], where: { ...scope, registeredAt: { not: null } }, _count: { _all: true } }),
  ]);

  const ensure = (id: string) => {
    const existing = byId.get(id);
    if (existing) return existing;
    const fresh = { ...EMPTY_COUNTS };
    byId.set(id, fresh);
    return fresh;
  };

  for (const r of contacts) ensure(r.campaignId).contacts = r._count._all;
  for (const r of invitesSent) ensure(r.campaignId).invitesSent += 1;
  for (const r of scored) ensure(r.campaignId).scored = r._count._all;
  for (const r of approved) ensure(r.campaignId).approved = r._count._all;
  for (const r of attended) ensure(r.campaignId).attended = r._count._all;
  for (const r of registered) ensure(r.campaignId).registered = r._count._all;

  return byId;
}

/**
 * The three figures shown on a campaign card, chosen by what the campaign is
 * currently doing — a draft has nothing sent, so "Invites sent: 0" is noise,
 * whereas "Approved" is the number the operator is actually working towards.
 *
 * A campaign with no imported contacts (the seeded historical campaigns, or a
 * fresh draft) falls back to its stored summary fields. Once real contacts
 * exist, everything here is computed live.
 */
export function getCampaignCardStats(campaign: CardStatsCampaign, counts: CampaignCardCounts = EMPTY_COUNTS): CardStats {
  const contactCount = counts.contacts;

  const { invitesSent: sentCount, scored: scoredCount, approved: approvedCount, attended: attendedCount, registered: registeredCount } = counts;

  const registered = registeredCount;

  if (campaign.status === 'draft') {
    return [
      { label: 'Contacts', value: contactCount },
      { label: 'Scored', value: scoredCount },
      { label: 'Approved', value: approvedCount },
    ];
  }

  if (campaign.status === 'live') {
    return [
      { label: 'Invites sent', value: sentCount },
      { label: 'Approved', value: approvedCount },
      { label: 'Registered', value: registered },
    ];
  }

  return [
    { label: 'Registered', value: registered },
    { label: 'Attended', value: attendedCount },
    // Shared definition (attended / registered) — this used to divide by
    // approved, so the same campaign read a different attendance rate here
    // than on the dashboard and its own Overview tab.
    { label: 'Attendance', value: formatAttendanceRate(attendedCount, registered) },
  ];
}

export interface ListKpi {
  label: string;
  value: string;
}

/**
 * The four figures above the webinar list. Deliberately computed from the
 * campaigns passed in rather than a fresh query, so the numbers always agree
 * with the cards on screen — a KPI row that counts archived campaigns while
 * the grid below hides them is the kind of mismatch nobody reports but
 * everybody distrusts.
 */
export function getListKpis(
  campaigns: ListKpiCampaign[],
  attendedByCampaign: Map<string, { attended: number; registered: number }>
): ListKpi[] {
  const upcoming = campaigns.filter(c => (c.status === 'live' || c.status === 'draft') && c.scheduledAt && c.scheduledAt > new Date()).length;
  const totalRegistered = campaigns.reduce((sum, c) => sum + (attendedByCampaign.get(c.id)?.registered ?? 0), 0);
  const rates = campaigns.filter(c => c.status === 'completed').map(c => attendedByCampaign.get(c.id)).filter((c): c is {attended:number;registered:number} => !!c && c.registered > 0);
  const denominator = rates.reduce((sum,c) => sum + c.registered, 0);
  const avgAttendance = denominator ? `${Math.round(rates.reduce((sum,c) => sum + c.attended, 0) / denominator * 100)}%` : DASH;

  return [
    { label: 'Webinars', value: String(campaigns.length) },
    { label: 'Upcoming', value: String(upcoming) },
    { label: 'Total registered', value: totalRegistered.toLocaleString() },
    { label: 'Avg. attendance', value: avgAttendance },
  ];
}
