'use server';

import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { findScoreBand } from '@/lib/scoreBands';
import { assertSetupEditable } from '@/lib/setupLock';
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
  await assertSetupEditable(validCampaignId);
  const { queueAudienceJob } = await import('@/lib/audienceJobs');
  return queueAudienceJob(validCampaignId, 'scoring');
}

export async function updateScoringConfigAction(campaignId: string, data: { prompt?: string; criteria?: string; threshold?: number }) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await assertSetupEditable(validCampaignId);
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

  if (threshold !== undefined) {
    await db.$transaction([
      db.contact.updateMany({
        where: {
          campaignId: validCampaignId,
          approvedManually: false,
          score: { not: null, gte: threshold },
        },
        data: { approved: true },
      }),
      db.contact.updateMany({
        where: {
          campaignId: validCampaignId,
          approvedManually: false,
          score: { not: null, lt: threshold },
        },
        data: { approved: false },
      }),
    ]);
  }

  revalidateCampaign(validCampaignId);
}

// approvedManually marks this contact's approval as a human decision — a
// later re-score (runScoringAction above) leaves it alone instead of
// overwriting it with the AI's threshold verdict.
export async function setApprovalAction(contactId: string, approved: boolean, campaignId?: string) {
  const validContactId = contactIdSchema.parse(contactId);
  const owner = await db.contact.findUnique({ where: { id: validContactId }, select: { campaignId: true } });
  if (campaignId && owner?.campaignId !== campaignId) throw new Error('Contact does not belong to this campaign.');
  if (owner?.campaignId) await assertSetupEditable(owner.campaignId);
  const updated = await db.contact.update({
    where: { id: validContactId },
    data: { approved: !!approved, approvedManually: true },
    select: { campaignId: true },
  });
  const cid = campaignId || updated.campaignId;
  if (cid) revalidateCampaign(cid);
}

export async function bulkSetApprovalAction(contactIds: string[], approved: boolean, campaignId?: string) {
  const validIds = z.array(contactIdSchema).parse(contactIds);
  const owners = await db.contact.findMany({ where: { id: { in: validIds } }, select: { id: true, campaignId: true } });
  if (owners.length !== validIds.length || (campaignId && owners.some(c => c.campaignId !== campaignId))) throw new Error('Contact selection does not belong to this campaign.');
  for (const cid of new Set(owners.map(c => c.campaignId))) await assertSetupEditable(cid);
  await db.contact.updateMany({ where: { id: { in: validIds } }, data: { approved: !!approved, approvedManually: true } });
  if (campaignId) {
    revalidateCampaign(campaignId);
  } else if (validIds.length > 0) {
    const contact = await db.contact.findUnique({ where: { id: validIds[0] }, select: { campaignId: true } });
    if (contact?.campaignId) revalidateCampaign(contact.campaignId);
  }
}

/**
 * Sets a contact's mobile number (used by the SMS/WhatsApp channels). An empty
 * value clears it. Normalizes nothing else — the channel send path strips
 * formatting at delivery time.
 */
export async function updateContactPhoneAction(contactId: string, phone: string, campaignId?: string): Promise<{ ok: boolean; error?: string }> {
  const validContactId = contactIdSchema.parse(contactId);
  const clean = (phone ?? '').trim();
  if (clean && !/^\+?[\d\s()-]{6,20}$/.test(clean)) {
    return { ok: false, error: "That doesn't look like a valid mobile number." };
  }
  const updated = await db.contact.update({ where: { id: validContactId }, data: { phone: clean || null }, select: { campaignId: true } });
  const cid = campaignId || updated.campaignId;
  if (cid) revalidateCampaign(cid);
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
  await assertSetupEditable(validCampaignId);
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

/**
 * Every contact matching the Audience tab's current search/band filter, for the
 * "Export all matching" button.
 *
 * The table is server-paginated at 50, and the export used to serialize just
 * the rows the client happened to be holding — so an operator on a 5,000-contact
 * campaign handed sales a 50-row file believing it was the whole list. The
 * filter is reproduced here rather than passed as a Prisma `where` so the
 * client can't ask for rows outside its campaign.
 */
export async function exportScoredContactsAction(
  campaignId: string,
  filter: { q?: string; band?: string } = {}
) {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const q = (filter.q ?? '').trim();
  const selectedBand = findScoreBand(filter.band);

  const rows = await db.contact.findMany({
    where: {
      campaignId: validCampaignId,
      ...(selectedBand ? { score: { gte: selectedBand.min, lt: selectedBand.max } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { title: { contains: q, mode: 'insensitive' as const } },
              { account: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ score: 'desc' }, { name: 'asc' }],
    select: {
      name: true,
      account: true,
      title: true,
      function: true,
      seniority: true,
      vertical: true,
      email: true,
      source: true,
      score: true,
      approved: true,
    },
  });

  return { ok: true as const, rows };
}
