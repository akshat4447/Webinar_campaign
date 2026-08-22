import { db } from '@/lib/db';
import type { Campaign } from '@/lib/generated/prisma/client';

export interface CardStats {
  l1: string;
  v1: string | number;
  l2: string;
  v2: string | number;
}

// A campaign with no real imported contacts yet (the 3 seeded "completed"
// campaigns, or a fresh draft) falls back to its stored historical numbers.
// Once real contacts exist, the card reflects real, live-computed activity.
export async function getCampaignCardStats(campaign: Campaign): Promise<CardStats> {
  const contactCount = await db.contact.count({ where: { campaignId: campaign.id } });

  if (contactCount === 0) {
    if (campaign.status === 'draft') return { l1: 'Registered', v1: 'Draft', l2: 'Attendance', v2: '—' };
    if (campaign.status === 'live') return { l1: 'Invites sent', v1: campaign.invites ?? '—', l2: 'Registered', v2: campaign.registrations ?? '—' };
    return { l1: 'Attendance', v1: campaign.attendance ?? '—', l2: 'Demo reqs', v2: campaign.demoRequests ?? '—' };
  }

  const [sentCount, approvedCount, attendedCount] = await Promise.all([
    db.cadenceSend.count({ where: { campaignId: campaign.id, status: 'sent' } }),
    db.contact.count({ where: { campaignId: campaign.id, approved: true } }),
    db.contact.count({ where: { campaignId: campaign.id, attended: true } }),
  ]);

  if (campaign.status === 'draft') return { l1: 'Contacts', v1: contactCount, l2: 'Approved', v2: approvedCount };
  if (campaign.status === 'live') return { l1: 'Invites sent', v1: sentCount, l2: 'Approved', v2: approvedCount };
  return { l1: 'Attended', v1: attendedCount, l2: 'Approved', v2: approvedCount };
}
