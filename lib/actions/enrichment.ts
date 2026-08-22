'use server';

import { db } from '@/lib/db';
import { runEnrichment, verifyInferredEmails, type EnrichmentResult } from '@/lib/enrichment';
import { revalidateCampaign } from '@/lib/revalidate';

export async function runEnrichmentAction(campaignId: string): Promise<EnrichmentResult> {
  const result = await runEnrichment(campaignId);
  revalidateCampaign(campaignId);
  return result;
}

export async function verifyInferredEmailsAction(campaignId: string): Promise<number> {
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
  const [total, missingEmail, missingTitle, enriched, inferredUnverified] = await Promise.all([
    db.contact.count({ where: { campaignId } }),
    db.contact.count({ where: { campaignId, OR: [{ email: null }, { email: '' }] } }),
    db.contact.count({ where: { campaignId, title: '—' } }),
    db.contact.count({ where: { campaignId, enrichedAt: { not: null } } }),
    db.contact.count({ where: { campaignId, emailSimulated: true, emailVerified: false } }),
  ]);
  return { total, missingEmail, missingTitle, enriched, inferredUnverified };
}
