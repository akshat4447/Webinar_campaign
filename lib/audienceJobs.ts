import { db } from '@/lib/db';
import { assertSetupEditable } from '@/lib/setupLock';
import { runScoringBatch } from '@/lib/scoringRunner';
import { runEnrichment, type EnrichmentScopeConfig, type EnrichmentResult } from '@/lib/enrichment';
import { revalidateCampaign } from '@/lib/revalidate';

export async function queueAudienceJob(campaignId: string, kind: 'scoring' | 'enrichment', config?: EnrichmentScopeConfig): Promise<EnrichmentResult & { scoredCount?: number; completedCount?: number; queuedCount?: number; jobId?: string; preservedManualApprovals?: number; failedBatches?: number }> {
  const queued = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
    const campaign = await tx.campaign.findUniqueOrThrow({where:{id:campaignId}});
    if (campaign.archived || campaign.status !== 'draft' || campaign.cadenceStatus !== 'not_started') throw new Error('Audience setup is locked after launch.');
    const existing = await tx.operationJob.findFirst({ where: { campaignId, kind, status: { in: ['pending', 'processing'] } } });
    if (existing) return { job: existing, existing: true };
    const contacts = await tx.contact.findMany({ where: { campaignId, ...(config?.contactIds ? { id: { in: config.contactIds } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, ...(config?.sampleOnly ? { take: Math.max(1, Math.min(25, config.sampleSize ?? 3)) } : {}) });
    if (!contacts.length) return null;
    const job = await tx.operationJob.create({ data: { campaignId, kind, payloadJson: JSON.stringify({ contactIds: contacts.map(c => c.id), config }), total: contacts.length } });
    return {job, existing:false};
  });
  if (!queued) return {ok:false,error:'No contacts selected.'};
  const {job} = queued;
  if (queued.existing) return {ok:true,scoredCount:job.cursor,jobId:job.id,queuedCount:job.total-job.cursor};
  const result = await processAudienceJob(job.id);
  return { ...result, scoredCount: result.completedCount, jobId: job.id };
}
export async function processAudienceJob(id: string): Promise<EnrichmentResult & { completedCount?: number; queuedCount?: number; jobId?: string }> {
  await db.operationJob.updateMany({ where: { id, status: 'processing', claimedAt: { lt: new Date(Date.now() - 120_000) } }, data: { status: 'pending', claimedAt: null } });
  const claimed = await db.operationJob.updateMany({ where: { id, status: 'pending', kind: { in: ['scoring', 'enrichment'] } }, data: { status: 'processing', claimedAt: new Date() } });
  const job = await db.operationJob.findUniqueOrThrow({ where: { id } });
  if (!claimed.count) return { ok: job.status !== 'failed', completedCount: job.cursor, queuedCount: job.total - job.cursor, error: job.error ?? undefined };
  try {
    await assertSetupEditable(job.campaignId);
    const payload = JSON.parse(job.payloadJson) as { contactIds: string[]; config?: EnrichmentScopeConfig };
    const batch = payload.contactIds.slice(job.cursor, job.cursor + (job.kind === 'scoring' ? 25 : 5));
    const result = job.kind === 'scoring' ? await runScoringBatch(job.campaignId, batch) : await runEnrichment(job.campaignId, { ...payload.config, sampleOnly: false, contactIds: batch });
    if (!result.ok || ('failedBatches' in result && result.failedBatches) || ('claudeFailedBatches' in result && result.claudeFailedBatches)) throw new Error(result.error || 'Provider returned incomplete results. Retry the remaining batch.');
    const cursor = job.cursor + batch.length;
    await db.operationJob.updateMany({ where: { id, status: 'processing' }, data: { cursor, status: cursor >= job.total ? 'completed' : 'pending', claimedAt: null, error: null, resultJson: JSON.stringify(result) } });
    revalidateCampaign(job.campaignId);
    return { ...result, completedCount: cursor, queuedCount: job.total - cursor, jobId: id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.operationJob.updateMany({ where: { id, status: 'processing' }, data: { status: 'failed', claimedAt: null, error: error.slice(0, 600) } });
    return { ok: false, error, completedCount: job.cursor, queuedCount: job.total - job.cursor, jobId: id };
  }
}
export async function processAudienceJobs() {
  const jobs = await db.operationJob.findMany({ where: { kind: { in: ['scoring', 'enrichment'] }, OR: [{ status: 'pending' }, { status: 'processing', claimedAt: { lt: new Date(Date.now() - 120_000) } }] }, orderBy: { updatedAt: 'asc' }, take: 1 });
  for (const job of jobs) await processAudienceJob(job.id);
}
