import { db } from '@/lib/db';
import type { Campaign } from '@/lib/generated/prisma/client';

export interface CardStat {
  label: string;
  value: string | number;
}

/** Exactly three, because the card's footer is a fixed three-column grid and a
 *  variable count would leave ragged gaps between cards in the same row. */
export type CardStats = [CardStat, CardStat, CardStat];

const DASH = '—';

function pct(part: number, whole: number): string {
  if (whole <= 0) return DASH;
  return `${Math.round((part / whole) * 100)}%`;
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
export async function getCampaignCardStats(campaign: Campaign): Promise<CardStats> {
  const contactCount = await db.contact.count({ where: { campaignId: campaign.id } });

  if (contactCount === 0) {
    if (campaign.status === 'draft') {
      return [
        { label: 'Contacts', value: 0 },
        { label: 'Approved', value: DASH },
        { label: 'Status', value: 'Not started' },
      ];
    }
    if (campaign.status === 'live') {
      return [
        { label: 'Invites sent', value: campaign.invites ?? DASH },
        { label: 'Registered', value: campaign.registrations ?? DASH },
        { label: 'Capacity', value: DASH },
      ];
    }
    return [
      { label: 'Registered', value: campaign.registrations ?? DASH },
      { label: 'Attendance', value: campaign.attendance ?? DASH },
      { label: 'Demo reqs', value: campaign.demoRequests ?? DASH },
    ];
  }

  const [sentCount, scoredCount, approvedCount, attendedCount, registeredCount] = await Promise.all([
    db.cadenceSend.count({ where: { campaignId: campaign.id, status: 'sent' } }),
    db.contact.count({ where: { campaignId: campaign.id, score: { not: null } } }),
    db.contact.count({ where: { campaignId: campaign.id, approved: true } }),
    db.contact.count({ where: { campaignId: campaign.id, attended: true } }),
    db.contact.count({ where: { campaignId: campaign.id, registeredAt: { not: null } } }),
  ]);

  const registered = campaign.registrations ?? registeredCount;

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
      { label: 'Registered', value: registered || DASH },
    ];
  }

  return [
    { label: 'Registered', value: registered || DASH },
    { label: 'Attended', value: attendedCount },
    { label: 'Attendance', value: attendedCount > 0 ? pct(attendedCount, approvedCount) : (campaign.attendance ?? DASH) },
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
export function getListKpis(campaigns: Campaign[], attendedByCampaign: Map<string, { attended: number; approved: number }>): ListKpi[] {
  const upcoming = campaigns.filter((c) => c.status === 'live' || c.status === 'draft').length;

  const totalRegistered = campaigns.reduce((sum, c) => sum + (c.registrations ?? 0), 0);

  // Averaged over campaigns that actually have an attendance figure, not over
  // every campaign — dividing by campaigns that never ran would drag the mean
  // towards zero and make a healthy programme look broken.
  const rates: number[] = [];
  for (const c of campaigns) {
    const live = attendedByCampaign.get(c.id);
    if (live && live.approved > 0 && live.attended > 0) {
      rates.push((live.attended / live.approved) * 100);
      continue;
    }
    const stored = c.attendance ? Number.parseFloat(c.attendance) : NaN;
    if (Number.isFinite(stored)) rates.push(stored);
  }
  const avgAttendance = rates.length > 0 ? `${Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)}%` : DASH;

  return [
    { label: 'Webinars', value: String(campaigns.length) },
    { label: 'Upcoming', value: String(upcoming) },
    { label: 'Total registered', value: totalRegistered > 0 ? totalRegistered.toLocaleString() : DASH },
    { label: 'Avg. attendance', value: avgAttendance },
  ];
}
