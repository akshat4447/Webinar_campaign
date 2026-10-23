'use client';

import { continueAudienceJobAction } from '@/lib/actions/jobs';

interface JobStep {
  ok: boolean;
  error?: string;
  jobId?: string;
  completedCount?: number;
  queuedCount?: number;
}

/**
 * Keeps a scoring or enrichment job going until it is finished. The first call only processes one batch and
 * returns how many contacts are still queued; leaving the rest to a background worker meant that, wherever no
 * worker runs, one click handled a handful of contacts. Each further call runs about 40 seconds of work on the
 * server, so no request outlasts the platform's time limit, and `onProgress` lets the page show real progress.
 * A job that stops on an error (a provider limit, a rejected key) returns that error with its place kept.
 */
export async function finishAudienceJob<T extends JobStep>(
  campaignId: string,
  first: T,
  onProgress?: (done: number, total: number) => void,
): Promise<T> {
  let res = first;
  while (res.ok && res.jobId && (res.queuedCount ?? 0) > 0) {
    onProgress?.(res.completedCount ?? 0, (res.completedCount ?? 0) + (res.queuedCount ?? 0));
    res = (await continueAudienceJobAction(campaignId, res.jobId)) as unknown as T;
  }
  return res;
}
