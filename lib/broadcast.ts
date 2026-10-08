import { refreshLsqExclusions } from '@/lib/lsqExclusions';
import { db } from '@/lib/db';
import { sendEligibility } from '@/lib/sendEligibility';
import { resolveRecipient } from '@/lib/sendGuard';
import { renderMergeFields } from '@/lib/mergeFields';
import { sendNetcoreEmail } from '@/lib/netcore';
import { createOrUpdateLead, sendEmailToLead } from '@/lib/leadsquared';
import { deliverChannelMessage, getChannelDeliveryMode } from '@/lib/channelDelivery';
import { deliverOnce, DeliveryUnknownError } from '@/lib/deliveryGuard';
import { quotaDay, reserveSendQuota, releaseSendQuota } from '@/lib/sendQuota';
import type { BroadcastReminderInput } from '@/lib/actions/broadcastReminder';
import { wallClockToDate } from '@/lib/dateFormat';
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
type Results = Record<string, { status: 'accepted' | 'queued' | 'skipped' | 'failed' | 'unknown'; reason?: string }>;

export async function processBroadcastJob(jobId: string, deadlineMs = 20_000) {
  await db.operationJob.updateMany({ where: { id: jobId, status: 'processing', claimedAt: { lt: new Date(Date.now() - 120_000) } }, data: { status: 'pending', claimedAt: null } });
  const claim = await db.operationJob.updateMany({ where: { id: jobId, kind: 'broadcast', status: 'pending' }, data: { status: 'processing', claimedAt: new Date() } });
  let job = await db.operationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!claim.count) return summarize(job);
  const payload = JSON.parse(job.payloadJson) as { input: BroadcastReminderInput; contactIds: string[] };
  const results = JSON.parse(job.resultJson) as Results;
  const campaign = await db.campaign.findUnique({ where: { id: job.campaignId }, include: { speakers: true } });
  if (!campaign || campaign.status === 'completed' || campaign.archived || campaign.cadenceStatus === 'stopped') {
    job = await db.operationJob.update({ where: { id: job.id }, data: { status: 'failed', error: 'Webinar is closed or removed.', claimedAt: null } });
    return summarize(job);
  }
  await refreshLsqExclusions(campaign.id);
  const deadline = Date.now() + deadlineMs;
  const channels = payload.input.channel === 'all' ? ['email', 'whatsapp', 'sms'] as const : [payload.input.channel];
  for (let cursor = job.cursor; cursor < payload.contactIds.length && Date.now() < deadline; cursor++) {
    const current = await db.operationJob.findUnique({ where: { id: job.id }, select: { status: true } });
    if (current?.status === 'cancelled') break;
    const state = await db.campaign.findUniqueOrThrow({where:{id:job.campaignId},select:{status:true,archived:true,cadenceStatus:true}});
    if (state.archived || state.status === 'completed' || state.cadenceStatus === 'stopped') {
      await db.operationJob.update({where:{id:job.id},data:{status:'cancelled',claimedAt:null,error:'Webinar was closed or stopped.'}}); break;
    }
    if (state.cadenceStatus === 'paused') break;
    const c = await db.contact.findUnique({ where: { id: payload.contactIds[cursor], campaignId: job.campaignId } });
    if (c) for (const channel of channels) {
      const key = `${c.id}:${channel}`;
      if (results[key]) continue;
      const contact = payload.input.testMode ? { ...c, email: payload.input.testRecipientEmail! } : c;
      const eligibility = await sendEligibility(campaign.id, contact, channel);
      if (!eligibility.ok) { results[key] = { status: 'skipped', reason: eligibility.reason }; continue; }
      if (campaign.zoomMeetingId && !c.zoomJoinUrl && !payload.input.testMode) { results[key] = { status: 'skipped', reason: 'Personal Zoom join link is not ready.' }; continue; }
      const day = quotaDay(new Date(), campaign.timezone);
      const dayStart = wallClockToDate(`${day}T00:00`, campaign.timezone) ?? new Date();
      const observed = await db.cadenceSend.count({where:{campaignId:campaign.id,status:'sent',sentAt:{gte:dayStart}}});
      if (!(await reserveSendQuota(campaign.id, day, campaign.dailyLimit, observed, `${job.id}:${key}`))) {
        job = await db.operationJob.update({ where: { id: job.id }, data: { status: 'pending', claimedAt: null, cursor, resultJson: JSON.stringify(results), error: 'Daily dispatch limit reached; remaining work stays queued.' } });
        return summarize(job);
      }
      const link = contact.zoomJoinUrl || campaign.zoomLink || '';
      const merge = { firstName: c.name.split(' ')[0], company: c.account, topic: campaign.name, webinarTitle: campaign.name, link, zoomLink: link, date: campaign.date, speaker: campaign.speakers.map(s => s.name).join(', ') };
      const subject = renderMergeFields(payload.input.subject || `Reminder: ${campaign.name}`, merge);
      const body = renderMergeFields(payload.input.message, merge);
      try {
        const outcome = await deliverOnce(`${job.id}:${key}`, channel, async () => {
          if (channel === 'email') {
            const { email } = resolveRecipient(contact);
            if (campaign.emailProvider === 'netcore') return sendNetcoreEmail({ to: email, toName: c.name, subject, html: escapeHtml(body).replace(/\n/g, '<br/>'), text: body, tags: [campaign.id, 'broadcast_reminder'] });
            return sendEmailToLead({ recipientEmail: email, subject, contentHtml: escapeHtml(body).replace(/\n/g, '<br/>'), contentText: body });
          }
          let leadId = contact.lsqLeadId;
          if (!leadId && (await getChannelDeliveryMode(channel)) === 'trigger' && contact.email) {
            const lead = await createOrUpdateLead([{ Attribute: 'EmailAddress', Value: contact.email }, { Attribute: 'FirstName', Value: c.name.split(' ')[0] }, { Attribute: 'Phone', Value: contact.phone || '' }]);
            leadId = lead.Message.Id;
            await db.contact.update({ where: { id: c.id }, data: { lsqLeadId: leadId } });
          }
          return deliverChannelMessage({ channel, phone: contact.phone!, message: body, campaignName: campaign.name, stepKey: 'broadcast_reminder', lsqLeadId: leadId || '' });
        }, { campaignId: campaign.id, payload: { recipient: channel === 'email' ? contact.email : contact.phone, subject, body, channel } });
        const value = outcome.value as { strategyUsed?: string } | undefined;
        results[key] = { status: value?.strategyUsed === 'trigger' ? 'queued' : 'accepted' };
      } catch (error) {
        const unknown = error instanceof DeliveryUnknownError;
        if (!unknown) await releaseSendQuota(campaign.id, day, `${job.id}:${key}`);
        results[key] = { status: unknown ? 'unknown' : 'failed', reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
      }
    }
    job = await db.operationJob.update({ where: { id: job.id }, data: { cursor: cursor + 1, resultJson: JSON.stringify(results) } });
  }
  const problems = Object.values(results).filter(r => r.status === 'failed' || r.status === 'unknown').length;
  await db.operationJob.updateMany({ where: { id: job.id, status: { not: 'cancelled' } }, data: { status: job.cursor >= job.total ? (problems ? 'needs_attention' : 'completed') : 'pending', error: problems ? `${problems} deliveries need review. Check provider evidence before retrying uncertain outcomes.` : null, claimedAt: null } });
  job = await db.operationJob.findUniqueOrThrow({ where: { id: job.id } });
  return summarize(job);
}
function summarize(job: { id: string; total: number; cursor: number; resultJson: string; status: string; error: string | null }) {
  const rows = Object.values(JSON.parse(job.resultJson) as Results);
  const failedCount = rows.filter(r => r.status === 'failed' || r.status === 'unknown').length;
  return { ok: job.status !== 'failed' && failedCount === 0, sentCount: rows.filter(r => r.status === 'accepted' || r.status === 'queued').length, failedCount, skippedCount: rows.filter(r => r.status === 'skipped').length, unknownCount: rows.filter(r => r.status === 'unknown').length, totalEligible: job.total, queuedCount: Math.max(0, job.total - job.cursor), jobId: job.id, status: job.status, error: job.error ?? undefined };
}
export async function processBroadcastJobs(budgetMs = 20_000) {
  const jobs = await db.operationJob.findMany({ where: { kind: 'broadcast', OR: [{ status: 'pending' }, { status: 'processing', claimedAt: { lt: new Date(Date.now() - 120_000) } }] }, orderBy: { updatedAt: 'asc' }, take: 5, select: { id: true } });
  const deadline = Date.now() + budgetMs;
  for (const job of jobs) { if (Date.now() >= deadline) break; await processBroadcastJob(job.id, Math.max(1_000, deadline - Date.now())); }
}
