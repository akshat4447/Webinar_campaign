'use server';

import { db } from '@/lib/db';
import { generatePersonalized, generateAllSteps, regenerateOne, repairLinks, DEFAULT_PERSONALIZATION_PROMPT, type GenerateResult } from '@/lib/personalization';
import { revalidateCampaign } from '@/lib/revalidate';

export async function generatePersonalizedAction(
  campaignId: string,
  stepKey: string,
  options?: { onlyMissing?: boolean }
): Promise<GenerateResult> {
  const result = await generatePersonalized(campaignId, stepKey, options);
  revalidateCampaign(campaignId);
  return result;
}

export async function generateAllStepsAction(
  campaignId: string,
  options?: { onlyMissing?: boolean }
): Promise<{ ok: boolean; totalGenerated: number; errors: string[] }> {
  const result = await generateAllSteps(campaignId, options);
  revalidateCampaign(campaignId);
  return result;
}

export async function regeneratePersonalizedAction(campaignId: string, contactId: string, stepKey: string): Promise<GenerateResult> {
  const result = await regenerateOne(campaignId, contactId, stepKey);
  revalidateCampaign(campaignId);
  return result;
}

export async function savePersonalizedAction(campaignId: string, messageId: string, subject: string | null, body: string) {
  const now = new Date();
  await db.personalizedMessage.update({
    where: { id: messageId },
    data: { subject, body, status: 'edited', editedAt: now },
  });
  revalidateCampaign(campaignId);
  return { savedAt: now.toISOString() };
}

export async function markReviewedAction(campaignId: string, messageId: string) {
  const now = new Date();
  await db.personalizedMessage.update({ where: { id: messageId }, data: { status: 'reviewed', reviewedAt: now } });
  revalidateCampaign(campaignId);
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

/** Drops ONE recipient's personalized copy so the shared template sends instead. */
export async function discardOnePersonalizedAction(campaignId: string, contactId: string, stepKey: string) {
  await db.personalizedMessage.deleteMany({ where: { campaignId, contactId, stepKey } });
  revalidateCampaign(campaignId);
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

/** Saves prompt, brief and aiInstructions together. */
export async function updateCampaignMessagingInstructionsAction(
  campaignId: string,
  data: { prompt: string; brief?: string; aiInstructions?: string }
) {
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      personalizationPrompt: data.prompt,
      ...(data.brief !== undefined ? { brief: data.brief } : {}),
      ...(data.aiInstructions !== undefined ? { aiInstructions: data.aiInstructions } : {}),
    },
  });
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

/** Generates 3 psychological copy angles (Pillar 1: A/B copy generation) */
export async function generateCopyAnglesAction(params: {
  campaignId: string;
  stepKey: string;
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  stepLabel: string;
  baseBody?: string;
}) {
  const { generateMessageAngles } = await import('@/lib/claude');
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: params.campaignId } });
  return generateMessageAngles({
    topic: campaign.name,
    speakerName: campaign.speakerName,
    speakerTitle: campaign.speakerTitle,
    brief: campaign.brief,
    channel: params.channel,
    stepLabel: params.stepLabel,
    baseBody: params.baseBody,
  });
}
