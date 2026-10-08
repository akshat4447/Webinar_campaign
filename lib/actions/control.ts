'use server';

import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';
import { diagnoseAttentionItem, type DiagnoseResult } from '@/lib/claude';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';

const campaignIdSchema = z.string().min(1);
const attentionIdSchema = z.string().min(1);
export async function togglePauseResumeAction(campaignId: string) {
  const validId = campaignIdSchema.parse(campaignId);
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validId } });
  if (campaign.status === 'completed' || campaign.archived || !['running', 'paused'].includes(campaign.cadenceStatus)) throw new Error('Only a running or paused cadence can be resumed.');
  const next = campaign.cadenceStatus === 'running' ? 'paused' : 'running';
  await db.campaign.update({ where: { id: validId }, data: { cadenceStatus: next } });
  revalidateCampaign(validId);
}

export async function stopCadenceAction(campaignId: string) {
  const validId = campaignIdSchema.parse(campaignId);
  await db.campaign.update({ where: { id: validId }, data: { cadenceStatus: 'stopped' } });
  revalidateCampaign(validId);
}

export async function retryFailedSendsAction(campaignId: string) {
  const validId = campaignIdSchema.parse(campaignId);
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: validId }, select: { cadenceStatus: true } });

  // A stopped cadence is a deliberate, one-way-door decision (see stopCadenceAction) —
  // resurrecting its failed sends back to "queued" would contradict that and let a
  // stray click re-queue mail for a campaign the operator explicitly ended. Retrying
  // while paused is fine: it re-queues, but processDueSends below still won't
  // actually send anything until the operator resumes.
  if (campaign.cadenceStatus === 'stopped' || campaign.cadenceStatus === 'not_started') {
    return { processed: 0, sent: 0, failed: 0, remaining: 0, dailyLimitReached: false, outsideSendWindow: false, blocked: true as const };
  }

  // Safeguard: do not re-queue pre-registration outreach for contacts who are now registered
  const registeredContacts = await db.contact.findMany({
    where: { campaignId: validId, registeredAt: { not: null } },
    select: { id: true },
  });
  const registeredContactIds = registeredContacts.map((c) => c.id);

  const preRegSteps = await db.cadenceStep.findMany({
    where: {
      campaignId: validId,
      OR: [
        { group: 'Pre-registration' },
        { key: { in: ['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final'] } },
      ],
    },
    select: { key: true },
  });
  const outreachKeys = Array.from(new Set(preRegSteps.map((s) => s.key).concat(['invite', 'smsInvite', 'waInvite', 'linkedin', 'nudge', 'final'])));

  if (registeredContactIds.length > 0 && outreachKeys.length > 0) {
    await db.cadenceSend.updateMany({
      where: {
        campaignId: validId,
        status: 'failed',
        NOT: {
          contactId: { in: registeredContactIds },
          stepKey: { in: outreachKeys },
        },
      },
      data: { status: 'queued', error: null, dueAt: new Date() },
    });
  } else {
    await db.cadenceSend.updateMany({
      where: { campaignId: validId, status: 'failed' },
      data: { status: 'queued', error: null, dueAt: new Date() },
    });
  }
  const result = await processDueSends(validId);
  revalidateCampaign(validId);
  return { ...result, blocked: false as const };
}

export async function resolveAttentionAction(attentionId: string, campaignId: string) {
  const validAttentionId = attentionIdSchema.parse(attentionId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.attentionItem.update({ where: { id: validAttentionId, campaignId: validCampaignId }, data: { resolvedAt: new Date() } });
  revalidateCampaign(validCampaignId);
}

// This action already existed but nothing in the UI ever called it — Control
// Center had no way to make the cadence check for due sends on demand; you
// could only wait for the next cadence-tick run or click something else
// (Retry, which only touches failed sends) that happened to call processDueSends
// as a side effect. Wired to the new "Run due sends now" button.
export async function runDueSendsNowAction(campaignId: string) {
  const validId = campaignIdSchema.parse(campaignId);
  const result = await processDueSends(validId);
  revalidateCampaign(validId);
  return result;
}

export interface DiagnoseResponse {
  ok: boolean;
  error?: string;
  diagnosis?: DiagnoseResult;
}

/**
 * Backs the "Fix with AI" action on an attention item. Previously the only
 * "fix" action just navigated to the Scoring tab regardless of what actually
 * broke (an LSQ 500, a missing template, etc.) — this asks Claude to read the
 * item's own recorded error and explain it plus a concrete next step instead.
 */
export async function diagnoseAttentionItemAction(attentionId: string): Promise<DiagnoseResponse> {
  const validAttentionId = attentionIdSchema.parse(attentionId);
  const item = await db.attentionItem.findUniqueOrThrow({ where: { id: validAttentionId } });
  const campaign = await db.campaign.findUnique({ where: { id: item.campaignId } });
  try {
    const diagnosis = await diagnoseAttentionItem(item.title, item.detail, JSON.stringify({ campaignName: campaign?.name, vertical: campaign?.vertical, status: campaign?.status, cadenceStatus: campaign?.cadenceStatus }));
    return { ok: true, diagnosis };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}
