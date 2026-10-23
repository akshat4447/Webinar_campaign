import { db } from '@/lib/db';
import { assertSetupEditable } from '@/lib/setupLock';
import { runScoringBatch } from '@/lib/scoringRunner';
import { runEnrichment, type EnrichmentScopeConfig, type EnrichmentResult } from '@/lib/enrichment';
import { APOLLO_BULK_SIZE } from '@/lib/apolloVerify';
import { revalidateCampaign } from '@/lib/revalidate';

/** Contacts handled per step: Claude scores 25 at a time; enrichment asks Apollo for ten, which is its bulk limit. */
const batchSizeFor = (kind: string) => (kind === 'scoring' ? 25 : APOLLO_BULK_SIZE);

/** Adds the counts of one batch to the running totals, so the final result describes the whole job. */
function accumulate(previousJson: string | null, next: Record<string, unknown>): Record<string, unknown> {
  let previous: Record<string, unknown> = {};
  try {
    previous = previousJson ? (JSON.parse(previousJson) as Record<string, unknown>) : {};
  } catch {
    previous = {};
  }
  const merged: Record<string, unknown> = { ...next };
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === 'number' && typeof previous[k] === 'number' && !/^(queued|completed)Count$|RetryAfterSec$/.test(k)) merged[k] = (previous[k] as number) + v;
  }
  delete merged.samplePreviews;
  return merged;
}

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
    const batch = payload.contactIds.slice(job.cursor, job.cursor + batchSizeFor(job.kind));
    const result = job.kind === 'scoring' ? await runScoringBatch(job.campaignId, batch) : await runEnrichment(job.campaignId, { ...payload.config, sampleOnly: false, contactIds: batch });
    // Apollo cut the batch short (rate limit, outage, rejected key): the contacts it did not answer for were left
    // untouched, so the job stops here with its cursor where it was and can be retried, instead of marching on
    // through thousands of batches that would all fail the same way.
    if ('apolloDeferred' in result && result.apolloDeferred) throw new Error(result.apolloApiError || 'Apollo could not look up every contact in this batch. Retry the remaining batch.');
    if ('apolloFatal' in result && result.apolloFatal) throw new Error(result.apolloApiError || 'Apollo rejected the request.');
    if (!result.ok || ('failedBatches' in result && result.failedBatches) || ('claudeFailedBatches' in result && result.claudeFailedBatches)) throw new Error(result.error || 'Provider returned incomplete results. Retry the remaining batch.');
    const cursor = job.cursor + batch.length;
    // The result reported for the job is the sum over its batches, not just the last one.
    const totals = accumulate(job.resultJson, result as unknown as Record<string, unknown>);
    await db.operationJob.updateMany({ where: { id, status: 'processing' }, data: { cursor, status: cursor >= job.total ? 'completed' : 'pending', claimedAt: null, error: null, resultJson: JSON.stringify(totals) } });
    revalidateCampaign(job.campaignId);
    return { ...(totals as unknown as EnrichmentResult), completedCount: cursor, queuedCount: job.total - cursor, jobId: id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.operationJob.updateMany({ where: { id, status: 'processing' }, data: { status: 'failed', claimedAt: null, error: error.slice(0, 600) } });
    return { ok: false, error, completedCount: job.cursor, queuedCount: job.total - job.cursor, jobId: id };
  }
}
/**
 * Runs batches of one job until it finishes, fails, or the time budget is used. One click used to process a
 * single batch and leave the rest to the background worker, so on a host where no worker runs, a list of 5,000
 * had its first five contacts enriched and the rest sat "queued" for ever. The browser now keeps calling this
 * (one slice per call, to stay inside the request time limit) until the job is done.
 */
export async function advanceAudienceJob(id: string, budgetMs = 40_000): Promise<EnrichmentResult & { completedCount?: number; queuedCount?: number; jobId?: string; scoredCount?: number }> {
  const startedAt = Date.now();
  let last = await processAudienceJob(id);
  while (last.ok && (last.queuedCount ?? 0) > 0 && Date.now() - startedAt < budgetMs) last = await processAudienceJob(id);
  return { ...last, scoredCount: last.completedCount };
}

/** The worker's share: keeps going through pending jobs, batch after batch, until its time is up. */
export async function processAudienceJobs(budgetMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) {
    const jobs = await db.operationJob.findMany({ where: { kind: { in: ['scoring', 'enrichment'] }, OR: [{ status: 'pending' }, { status: 'processing', claimedAt: { lt: new Date(Date.now() - 120_000) } }] }, orderBy: { updatedAt: 'asc' }, take: 1 });
    if (jobs.length === 0) return;
    await processAudienceJob(jobs[0].id);
  }
}
