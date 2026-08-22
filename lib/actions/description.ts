'use server';

import { db } from '@/lib/db';
import { improveDescription } from '@/lib/claude';

export async function improveDescriptionAction(campaignId: string, current: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { name: true, vertical: true } });
  try {
    const improved = await improveDescription({ topic: campaign.name, vertical: campaign.vertical, current });
    if (!improved) return { ok: false as const, error: 'Claude returned nothing usable — try again.' };
    return { ok: true as const, description: improved };
  } catch (err) {
    return { ok: false as const, error: String(err).slice(0, 200) };
  }
}
