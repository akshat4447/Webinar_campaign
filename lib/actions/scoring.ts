'use server';

import { db } from '@/lib/db';
import { scoreContacts } from '@/lib/claude';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';

const campaignIdSchema = z.string().min(1);
const contactIdSchema = z.string().min(1);
const scoringConfigSchema = z.object({
  prompt: z.string().optional(),
  criteria: z.string().optional(),
  threshold: z.number().min(0).max(100).optional(),
});

export async function runScoringAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validCampaignId } });
  const contacts = await db.contact.findMany({ where: { campaignId: validCampaignId } });
  if (contacts.length === 0) return { ok: false, error: 'No contacts imported yet — go to Setup first.' };

  try {
    const results = await scoreContacts(
      campaign.name,
      campaign.vertical,
      campaign.scoringPrompt,
      campaign.scoringCriteria,
      contacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        function: c.function,
        seniority: c.seniority,
        account: c.account,
        vertical: c.vertical,
        missingInfo: c.missingInfo,
      }))
    );

    // Contacts a human has explicitly approved/unapproved (approvedManually, set
    // by setApprovalAction / bulkSetApprovalAction) keep their approval as-is —
    // a re-score used to silently overwrite that decision with the threshold
    // verdict on every run. The score and explanation still refresh either way.
    const validIds = new Set(contacts.map((c) => c.id));
    const validResults = results.filter((r) => validIds.has(r.id));
    const manuallySet = new Set(contacts.filter((c) => c.approvedManually).map((c) => c.id));
    await db.$transaction(
      validResults.map((r) =>
        db.contact.update({
          where: { id: r.id },
          data: {
            score: r.score,
            explanation: r.explanation,
            ...(manuallySet.has(r.id) ? {} : { approved: r.score >= campaign.scoringThreshold }),
          },
        })
      )
    );
    const preserved = validResults.filter((r) => manuallySet.has(r.id)).length;

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Claude scored ${validResults.length} contacts against "${campaign.name}"${preserved > 0 ? ` — kept ${preserved} manually-set approval${preserved === 1 ? '' : 's'} as-is` : ''}`,
        dot: 'var(--accent-500)',
      },
    });

    await resolveAttentionItems(campaignId, ['Audience scoring failed']);
    revalidateCampaign(campaignId);
    return { ok: true, scoredCount: validResults.length, preservedManualApprovals: preserved };
  } catch (err) {
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'Audience scoring failed',
      detail: String(err).slice(0, 300),
      actionsCsv: 'retry',
    });
    return { ok: false, error: String(err) };
  }
}

export async function updateScoringConfigAction(campaignId: string, data: { prompt?: string; criteria?: string; threshold?: number }) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const parsedData = scoringConfigSchema.parse(data);

  // The Scoring tab's slider already clamps to 0–100 client-side, but the
  // server action is the actual boundary — clamp here too rather than trusting
  // the UI never sends anything else.
  const threshold = parsedData.threshold !== undefined ? Math.max(0, Math.min(100, Math.round(parsedData.threshold))) : undefined;

  await db.campaign.update({
    where: { id: validCampaignId },
    data: {
      ...(parsedData.prompt !== undefined ? { scoringPrompt: parsedData.prompt } : {}),
      ...(parsedData.criteria !== undefined ? { scoringCriteria: parsedData.criteria } : {}),
      ...(threshold !== undefined ? { scoringThreshold: threshold } : {}),
    },
  });
  revalidateCampaign(validCampaignId);
}

// approvedManually marks this contact's approval as a human decision — a
// later re-score (runScoringAction above) leaves it alone instead of
// overwriting it with the AI's threshold verdict.
export async function setApprovalAction(contactId: string, approved: boolean) {
  const validContactId = contactIdSchema.parse(contactId);
  await db.contact.update({ where: { id: validContactId }, data: { approved: !!approved, approvedManually: true } });
}

export async function bulkSetApprovalAction(contactIds: string[], approved: boolean) {
  const validIds = z.array(contactIdSchema).parse(contactIds);
  await db.contact.updateMany({ where: { id: { in: validIds } }, data: { approved: !!approved, approvedManually: true } });
}

/**
 * Sets a contact's mobile number (used by the SMS/WhatsApp channels). An empty
 * value clears it. Normalizes nothing else — the channel send path strips
 * formatting at delivery time.
 */
export async function updateContactPhoneAction(contactId: string, phone: string): Promise<{ ok: boolean; error?: string }> {
  const validContactId = contactIdSchema.parse(contactId);
  const clean = (phone ?? '').trim();
  if (clean && !/^\+?[\d\s()-]{6,20}$/.test(clean)) {
    return { ok: false, error: "That doesn't look like a valid mobile number." };
  }
  await db.contact.update({ where: { id: validContactId }, data: { phone: clean || null } });
  return { ok: true };
}

/**
 * Approve every scored contact at or above the campaign's threshold.
 *
 * Leaves manual decisions alone: a contact somebody explicitly un-approved
 * stays un-approved, the same protection re-scoring already honours. Bulk
 * actions that silently overturn a human's call are how trust in them is lost.
 */
export async function approveAboveThresholdAction(campaignId: string) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: validCampaignId },
    select: { scoringThreshold: true },
  });
  const result = await db.contact.updateMany({
    where: {
      campaignId: validCampaignId,
      approved: false,
      approvedManually: false,
      score: { gte: campaign.scoringThreshold },
    },
    data: { approved: true },
  });
  revalidateCampaign(validCampaignId);
  return { approved: result.count, threshold: campaign.scoringThreshold };
}
