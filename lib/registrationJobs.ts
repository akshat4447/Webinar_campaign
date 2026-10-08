import { deliverOnce, DeliveryUnknownError } from '@/lib/deliveryGuard';
import { db } from '@/lib/db';
import { zoomIsConfigured } from '@/lib/zoom/client';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { syncRegistrantToZoom } from '@/lib/zoomRegistration';
import { postWebinarRegistrationActivity } from '@/lib/activityPush';
import { syncContactToLsqSuppressionList } from '@/lib/lsqSuppression';

/** Fair, leased work selection; completed contacts never occupy a retry batch. */
export async function processRegistrationJobs(opts: { contactId?: string; limit?: number; now?: Date; budgetMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  await db.registrationJob.updateMany({ where: { status: 'processing', claimedAt: { lt: new Date(now.getTime() - 120_000) } }, data: { status: 'pending', claimedAt: null } });
  const jobs = await db.registrationJob.findMany({ where: { ...(opts.contactId ? { contactId: opts.contactId } : {}), status: { in: ['pending', 'failed', 'blocked'] }, nextAttemptAt: { lte: now } }, orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }], take: Math.min(opts.limit ?? 50, 100), include: { contact: { include: { campaign: true } } } });
  const result = { checked: 0, zoomRetried: 0, zoomFixed: 0, lsqRetried: 0, lsqFixed: 0, suppressionRetried: 0, suppressionFixed: 0 };
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    const claimed = await db.registrationJob.updateMany({ where: { id: job.id, status: { in: ['pending', 'failed', 'blocked'] } }, data: { status: 'processing', claimedAt: now } });
    if (!claimed.count) continue;
    result.checked++;
    try {
      const c = await db.contact.findUnique({ where: { id: job.contactId, campaignId: job.campaignId }, include: { campaign: true } });
      if (!c) { await db.registrationJob.updateMany({where:{id:job.id},data:{status:'cancelled',claimedAt:null,error:'Contact was removed.'}}); continue; }
      if (job.kind === 'zoom') {
        if (!(await zoomIsConfigured())) throw new IntegrationNotConfigured('Zoom is not connected.');
        result.zoomRetried++;
        const outcome = await syncRegistrantToZoom(c.campaign, c);
        if (!outcome.ok) throw new Error(outcome.error);
        result.zoomFixed++;
      } else {
        if (!(await resolveIntegrationField('lsq', 'accessKey'))) throw new IntegrationNotConfigured('LeadSquared is not connected.');
        if (job.kind.startsWith('engagement_')) {
          const { pushEngagementActivities } = await import('@/lib/activityPush');
          const stage = job.kind.startsWith('engagement_attended') ? 'Attended' as const : 'No-show' as const;
          await deliverOnce(job.id, 'lsq-engagement', async () => {
            const outcome = await pushEngagementActivities(c.campaignId, [{ contactId: c.id, stage }], job.kind);
            if (outcome.failed || outcome.skipped) throw new Error('CRM engagement synchronization has no confirmed receipt.');
            return outcome;
          }, { campaignId: c.campaignId });
          await db.registrationJob.updateMany({ where: { id: job.id }, data: { status: 'completed', completedAt: new Date(), claimedAt: null, error: null } });
          continue;
        }
        // Personal join links must exist before CRM records the registration.
        if (c.campaign.zoomMeetingId && !c.zoomJoinUrl) throw new IntegrationNotConfigured('Waiting for the personal Zoom join link.');
        if (job.kind === 'lsq') {
          result.lsqRetried++;
          await deliverOnce(job.id, 'lsq-registration', async () => {
            const outcome = await postWebinarRegistrationActivity(c.campaignId, c.id, c.registrationSource ?? 'website');
            if (!outcome.ok || outcome.skipped || outcome.duplicate) throw new Error(outcome.error || 'CRM registration activity has no confirmed receipt.');
            return outcome;
          }, { campaignId: c.campaignId });
          result.lsqFixed++;
        } else {
          result.suppressionRetried++;
          if (!(await syncContactToLsqSuppressionList(c.campaignId, c.id))) throw new Error('Suppression list synchronization failed.');
          result.suppressionFixed++;
        }
      }
      await db.registrationJob.updateMany({ where: { id: job.id }, data: { status: 'completed', completedAt: new Date(), claimedAt: null, error: null } });
    } catch (error) {
      const blocked = error instanceof IntegrationNotConfigured;
      const delay = blocked ? 300_000 : Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7));
      await db.registrationJob.updateMany({ where: { id: job.id }, data: { status: error instanceof DeliveryUnknownError ? 'unknown' : blocked ? 'blocked' : 'failed', claimedAt: null, attempts: { increment: blocked ? 0 : 1 }, nextAttemptAt: new Date(now.getTime() + delay), error: (error instanceof Error ? error.message : String(error)).slice(0, 600) } });
    }
  }
  return result;
}

class IntegrationNotConfigured extends Error {}
