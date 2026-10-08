'use server';

import { revalidatePath } from 'next/cache';
import {
  addCampaignSuppression,
  bulkAddCampaignSuppression,
  getCampaignSuppressions,
  getCampaignSuppressionCount,
  removeCampaignSuppression,
} from '@/lib/campaignSuppression';
import { db } from '@/lib/db';

export async function getCampaignSuppressionsAction(campaignId: string, search?: string) {
  try {
    const items = await getCampaignSuppressions(campaignId, search);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), items: [] };
  }
}

export async function getCampaignSuppressionSummaryAction(campaignId: string) {
  try {
    const [campaignCount, globalCount] = await Promise.all([
      getCampaignSuppressionCount(campaignId),
      db.emailSuppression.count(),
    ]);
    return { ok: true, campaignCount, globalCount };
  } catch (err) {
    return { ok: false, campaignCount: 0, globalCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addCampaignSuppressionAction(
  campaignId: string,
  target: string,
  reason = 'manual'
) {
  try {
    if (!campaignId) throw new Error('Campaign ID is required');
    if (!target || !target.trim()) throw new Error('Email address or domain is required');

    const item = await addCampaignSuppression(campaignId, target, reason, 'manual');
    revalidatePath(`/campaigns/${campaignId}/cadence`);
    revalidatePath(`/campaigns/${campaignId}/audience`);
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function bulkAddCampaignSuppressionAction(
  campaignId: string,
  rawContent: string,
  defaultReason = 'csv_import'
) {
  try {
    if (!campaignId) throw new Error('Campaign ID is required');
    if (!rawContent || !rawContent.trim()) throw new Error('CSV or email content is required');

    const result = await bulkAddCampaignSuppression(campaignId, rawContent, defaultReason, 'csv_upload');
    revalidatePath(`/campaigns/${campaignId}/cadence`);
    revalidatePath(`/campaigns/${campaignId}/audience`);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, added: 0, skipped: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeCampaignSuppressionAction(campaignId: string, id: string) {
  try {
    if (!campaignId || !id) throw new Error('Campaign ID and Item ID are required');

    const ok = await removeCampaignSuppression(campaignId, id);
    if (!ok) throw new Error('Could not find or remove suppression entry');

    revalidatePath(`/campaigns/${campaignId}/cadence`);
    revalidatePath(`/campaigns/${campaignId}/audience`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
