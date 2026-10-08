'use server';

import {
  getLeadSquaredSuppressionConfig,
  createAndAttachLsqSuppressionList,
  updateCampaignSuppressionLists,
  syncContactToLsqSuppressionList,
  type LsqSuppressionConfig,
} from '@/lib/lsqSuppression';
import { revalidatePath } from 'next/cache';

export async function getLeadSquaredSuppressionConfigAction(campaignId: string): Promise<LsqSuppressionConfig> {
  return getLeadSquaredSuppressionConfig(campaignId);
}

export async function createAndAttachLsqSuppressionListAction(
  campaignId: string,
  listName: string,
  description?: string
) {
  const result = await createAndAttachLsqSuppressionList(campaignId, listName, description);
  const { refreshLsqExclusions } = await import('@/lib/lsqExclusions');
  await refreshLsqExclusions(campaignId, true);
  revalidatePath(`/campaigns/${campaignId}/audience`);
  revalidatePath(`/campaigns/${campaignId}/overview`);
  revalidatePath(`/campaigns/${campaignId}/cadence`);
  return result;
}

export async function updateCampaignSuppressionListsAction(
  campaignId: string,
  suppressionListId: string | null,
  exclusionListIds: string[] = []
) {
  const result = await updateCampaignSuppressionLists(campaignId, suppressionListId, exclusionListIds);
  const { refreshLsqExclusions } = await import('@/lib/lsqExclusions');
  await refreshLsqExclusions(campaignId, true);
  revalidatePath(`/campaigns/${campaignId}/audience`);
  revalidatePath(`/campaigns/${campaignId}/overview`);
  revalidatePath(`/campaigns/${campaignId}/cadence`);
  return result;
}

export async function syncRegistrantToLsqAction(campaignId: string, contactId: string) {
  const success = await syncContactToLsqSuppressionList(campaignId, contactId);
  return { ok: success };
}
