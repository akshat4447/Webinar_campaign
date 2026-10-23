'use server';

import { requireOperatorSession } from '@/lib/operatorSession';

import { db } from '@/lib/db';
import {
  runEnrichmentSample,
  getEnrichmentPreflight,
  verifyInferredEmails,
  type EnrichmentResult,
  type EnrichmentScopeConfig,
  type EnrichmentFieldSelection,
  type EnrichmentPreflightEstimate,
  type SampleEnrichmentPreview,
} from '@/lib/enrichment';
import { revalidateCampaign } from '@/lib/revalidate';
import { assertSetupEditable } from '@/lib/setupLock';

export async function runEnrichmentAction(
  campaignId: string,
  config?: EnrichmentScopeConfig
): Promise<EnrichmentResult> {
  await requireOperatorSession();
  await assertSetupEditable(campaignId);
  const { queueAudienceJob } = await import('@/lib/audienceJobs');
  const result = await queueAudienceJob(campaignId, 'enrichment', config);
  revalidateCampaign(campaignId);
  return result;
}

export async function getEnrichmentPreflightAction(
  campaignId: string,
  fields?: Partial<EnrichmentFieldSelection>
): Promise<EnrichmentPreflightEstimate> {
  await requireOperatorSession();
  return getEnrichmentPreflight(campaignId, fields);
}

export async function runEnrichmentSampleAction(
  campaignId: string,
  sampleSize: number = 3,
  fields?: Partial<EnrichmentFieldSelection>
): Promise<{ ok: boolean; error?: string; samples?: SampleEnrichmentPreview[] }> {
  await requireOperatorSession();
  const result = await runEnrichmentSample(campaignId, sampleSize, fields);
  revalidateCampaign(campaignId);
  return result;
}

export async function verifyInferredEmailsAction(campaignId: string): Promise<number> {
  await requireOperatorSession();
  const count = await verifyInferredEmails(campaignId);
  revalidateCampaign(campaignId);
  return count;
}

export interface EnrichmentStats {
  total: number;
  missingEmail: number;
  missingTitle: number;
  enriched: number;
  inferredUnverified: number;
}

export async function getEnrichmentStats(campaignId: string): Promise<EnrichmentStats> {
  await requireOperatorSession();
  const [total, missingEmail, missingTitle, enriched, inferredUnverified] = await Promise.all([
    db.contact.count({ where: { campaignId } }),
    db.contact.count({ where: { campaignId, OR: [{ email: null }, { email: '' }] } }),
    db.contact.count({ where: { campaignId, title: '—' } }),
    db.contact.count({ where: { campaignId, enrichedAt: { not: null } } }),
    db.contact.count({ where: { campaignId, emailSimulated: true, emailVerified: false } }),
  ]);
  return { total, missingEmail, missingTitle, enriched, inferredUnverified };
}
