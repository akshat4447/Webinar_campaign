'use server';

import { db } from '@/lib/db';
import { processDueSends, advanceSimulatedClock } from '@/lib/cadence';
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
  const now = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { simulatedNow: true } });
  await db.cadenceSend.updateMany({
    where: { campaignId, status: 'failed' },
    data: { status: 'queued', error: null, dueAt: now.simulatedNow ?? new Date() },
  });
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return result;
}

export async function resolveAttentionAction(attentionId: string, campaignId: string) {
  await db.attentionItem.update({ where: { id: attentionId }, data: { resolvedAt: new Date() } });
  revalidateCampaign(campaignId);
}

export async function runDueSendsNowAction(campaignId: string) {
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return result;
}

export async function advanceSimulatedClockAction(campaignId: string, days: number) {
  const next = await advanceSimulatedClock(campaignId, days);
  const result = await processDueSends(campaignId);
  revalidateCampaign(campaignId);
  return { simulatedNow: next.toISOString(), ...result };
}
