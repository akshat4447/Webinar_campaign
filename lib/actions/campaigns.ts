'use server';

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { revalidateCampaign } from '@/lib/revalidate';

export async function createCampaignAction(): Promise<string> {
  const count = await db.campaign.count();
  const campaign = await db.campaign.create({
    data: {
      name: `Untitled webinar ${count + 1}`,
      vertical: 'Unassigned',
      date: 'Not scheduled yet',
      status: 'draft',
      registrationLink: 'lsq.co/w/untitled',
    },
  });
  await provisionCampaignDefaults(campaign.id);
  revalidateCampaign(campaign.id);
  return campaign.id;
}

/** Hides a campaign from the main landing grid without touching its data or status. Reversible. */
export async function archiveCampaignAction(id: string, archived: boolean) {
  await db.campaign.update({ where: { id }, data: { archived } });
  revalidateCampaign(id);
}

/**
 * Permanently removes a campaign and everything under it — contacts, templates,
 * cadence steps/sends, personalized copy, activity log, attention items. Every
 * child table cascades from Campaign (onDelete: Cascade), so this one call is
 * complete; nothing is left orphaned.
 */
export async function deleteCampaignAction(id: string) {
  await db.campaign.delete({ where: { id } });
  revalidateCampaign(id);
}
