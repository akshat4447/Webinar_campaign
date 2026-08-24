'use server';

import { db } from '@/lib/db';
import { processDueSends, advanceSimulatedClock } from '@/lib/cadence';
import { diagnoseAttentionItem, type DiagnoseResult } from '@/lib/claude';
import { revalidateCampaign } from '@/lib/revalidate';

export async function togglePauseResumeAction(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const next = campaign.cadenceStatus === 'running' ? 'paused' : 'running';
  await db.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: next } });
  revalidateCampaign(campaignId);
}

export async function stopCadenceAction(campaignId: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { cadenceStatus: 'stopped' } });
  revalidateCampaign(campaignId);
}

export async function retryFailedSendsAction(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { simulatedNow: true, cadenceStatus: true } });

  // A stopped cadence is a deliberate, one-way-door decision (see stopCadenceAction) —
  // resurrecting its failed sends back to "queued" would contradict that and let a
  // stray click re-queue mail for a campaign the operator explicitly ended. Retrying
  // while paused is fine: it re-queues, but processDueSends below still won't
  // actually send anything until the operator resumes.
  if (campaign.cadenceStatus === 'stopped' || campaign.cadenceStatus === 'not_started') {
    return { processed: 0, sent: 0, failed: 0, remaining: 0, dailyLimitReached: false, outsideSendWindow: false, blocked: true as const };
  }

  await db.cadenceSend.updateMany({
    where: { campaignId, status: 'failed' },
    data: { status: 'queued', error: null, dueAt: campaign.simulatedNow ?? new Date() },
  });
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return { ...result, blocked: false as const };
}

export async function resolveAttentionAction(attentionId: string, campaignId: string) {
  await db.attentionItem.update({ where: { id: attentionId }, data: { resolvedAt: new Date() } });
  revalidateCampaign(campaignId);
}

// This action already existed but nothing in the UI ever called it — Control
// Center had no way to make the cadence check for due sends on demand; you
// could only wait for the next cadence-tick run or click something else
// (Retry, which only touches failed sends) that happened to call processDueSends
// as a side effect. Wired to the new "Run due sends now" button.
export async function runDueSendsNowAction(campaignId: string) {
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
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
  const item = await db.attentionItem.findUniqueOrThrow({ where: { id: attentionId } });
  const campaign = await db.campaign.findUnique({ where: { id: item.campaignId } });
  try {
    const diagnosis = await diagnoseAttentionItem(item.title, item.detail, JSON.stringify({ campaignName: campaign?.name, vertical: campaign?.vertical, status: campaign?.status, cadenceStatus: campaign?.cadenceStatus }));
    return { ok: true, diagnosis };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

export async function advanceSimulatedClockAction(campaignId: string, days: number) {
  const next = await advanceSimulatedClock(campaignId, days);
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return { simulatedNow: next.toISOString(), ...result };
}
