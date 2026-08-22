'use server';

import { db } from '@/lib/db';
import { provisionCampaignDefaults } from '@/lib/campaignDefaults';
import { revalidatePath } from 'next/cache';

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
  revalidatePath('/');
  return campaign.id;
}
