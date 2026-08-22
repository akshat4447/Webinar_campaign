'use server';

import { db } from '@/lib/db';
import { generatePersonalized, regenerateOne, repairLinks, DEFAULT_PERSONALIZATION_PROMPT, type GenerateResult } from '@/lib/personalization';
import { revalidateCampaign } from '@/lib/revalidate';

export async function generatePersonalizedAction(campaignId: string, stepKey: string): Promise<GenerateResult> {
  const result = await generatePersonalized(campaignId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

export async function regeneratePersonalizedAction(campaignId: string, contactId: string, stepKey: string): Promise<GenerateResult> {
  const result = await regenerateOne(campaignId, contactId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

export async function savePersonalizedAction(messageId: string, subject: string | null, body: string) {
  const now = new Date();
  await db.personalizedMessage.update({
    where: { id: messageId },
    data: { subject, body, status: 'edited', editedAt: now },
  });
  return { savedAt: now.toISOString() };
}

export async function markReviewedAction(messageId: string) {
  const now = new Date();
  await db.personalizedMessage.update({ where: { id: messageId }, data: { status: 'reviewed', reviewedAt: now } });
  return { reviewedAt: now.toISOString() };
}

export async function markAllReviewedAction(campaignId: string, stepKey: string) {
  const result = await db.personalizedMessage.updateMany({
    where: { campaignId, stepKey, status: { in: ['draft', 'edited'] } },
    data: { status: 'reviewed', reviewedAt: new Date() },
  });
  if (result.count > 0) {
    await db.activityLogEntry.create({
      data: { campaignId, text: `${result.count} personalized message${result.count === 1 ? '' : 's'} marked reviewed`, dot: 'var(--success-500)' },
    });
  }
  revalidateCampaign(campaignId);
  return result.count;
}

/** Drops the personalized copy for a step so the shared template takes over again. */
export async function discardPersonalizedAction(campaignId: string, stepKey: string) {
  const result = await db.personalizedMessage.deleteMany({ where: { campaignId, stepKey } });
  await db.activityLogEntry.create({
    data: { campaignId, text: `Discarded ${result.count} personalized message(s) — reverting to the shared template`, dot: 'var(--warning-700)' },
  });
  revalidateCampaign(campaignId);
  return result.count;
}

/** Swaps a superseded registration link for the current one, no model call. */
export async function repairLinksAction(campaignId: string, stepKey: string) {
  const result = await repairLinks(campaignId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

/** Saves edited tone/emphasis instructions for this campaign's personalization. */
export async function updatePersonalizationPromptAction(campaignId: string, prompt: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { personalizationPrompt: prompt } });
  revalidateCampaign(campaignId);
  return { savedAt: new Date().toISOString() };
}

/**
 * Read-only — hands back the built-in default text so "Reset to default" can
 * refill the textarea. Deliberately does not write to the DB: reset should be
 * an edit like any other, requiring the same explicit Save to persist, not a
 * side effect that fires before the user decides to keep it.
 */
export async function getDefaultPersonalizationPromptAction(): Promise<string> {
  return DEFAULT_PERSONALIZATION_PROMPT;
}
