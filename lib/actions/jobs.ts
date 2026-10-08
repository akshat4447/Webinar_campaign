'use server';
import { db } from '@/lib/db';
import { revalidateCampaign } from '@/lib/revalidate';
import { z } from 'zod';
export async function getCampaignJobsAction(campaignId: string) {
  const jobs = await db.operationJob.findMany({ where: { campaignId }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, kind: true, status: true, cursor: true, total: true, error: true } });
  const registrationFailures = await db.registrationJob.count({ where: { campaignId, status: { in: ['failed', 'blocked', 'unknown'] } } });
  const unknownSends = await db.cadenceSend.count({ where: { campaignId, status: 'unknown' } });
  const heartbeat = await db.appSetting.findUnique({where:{key:'worker.lastTick'}});
  const uncertainOperations = await db.deliveryAttempt.findMany({where:{campaignId,status:'unknown'},orderBy:{startedAt:'desc'},take:20,select:{key:true,provider:true,sendId:true,error:true}});
  return { jobs, registrationFailures, unknownSends, uncertainOperations, heartbeat: heartbeat ? JSON.parse(heartbeat.value) as {timestamp:string;ok:boolean;errors:string[]} : null };
}
export async function updateCampaignJobAction(campaignId: string, jobId: string, action: 'cancel' | 'retry') {
  z.enum(['cancel', 'retry']).parse(action);
  const statuses = action === 'cancel' ? ['pending', 'processing', 'failed', 'needs_attention'] : ['failed'];
  const changed = await db.operationJob.updateMany({ where: { id: jobId, campaignId, status: { in: statuses } }, data: { status: action === 'cancel' ? 'cancelled' : 'pending', error: null, claimedAt: null } });
  if (!changed.count) throw new Error('This job cannot be changed in its current state.');
  revalidateCampaign(campaignId);
}
export async function confirmDeliveryOutcomeAction(campaignId: string, sendId: string, outcome: 'accepted' | 'rejected', evidence: string) {
  z.enum(['accepted', 'rejected']).parse(outcome);
  const note = z.string().trim().min(8).max(500).parse(evidence);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "CadenceSend" WHERE "id" = ${sendId} AND "campaignId" = ${campaignId} FOR UPDATE`;
    const send = await tx.cadenceSend.findUniqueOrThrow({ where: { id: sendId, campaignId } });
    if (send.status !== 'unknown') throw new Error('Only uncertain deliveries require confirmation.');
    await tx.deliveryAttempt.updateMany({ where: { sendId, campaignId, status: { in: ['unknown', 'dispatching'] } }, data: { status: outcome === 'accepted' ? 'accepted' : 'failed', receiptJson: JSON.stringify({ manualConfirmation: note, outcome }), finishedAt: new Date() } });
    await tx.cadenceSend.update({ where: { id: sendId }, data: { status: outcome === 'accepted' ? 'sent' : 'queued', deliveryOutcome: outcome, sentAt: outcome === 'accepted' ? new Date() : null, claimedAt: null, error: null } });
    await tx.activityLogEntry.create({ data: { campaignId, text: `Delivery ${sendId}: operator confirmed ${outcome}. Provider evidence: ${note}`, dot: 'var(--warning-700)' } });
  });
  if (outcome === 'rejected') {
    const { releaseSendQuota } = await import('@/lib/sendQuota');
    await releaseSendQuota(campaignId, '', sendId);
  }
  revalidateCampaign(campaignId);
}

/** Resolve a lost provider response only with externally checked evidence. */
export async function confirmOperationOutcomeAction(campaignId: string, attemptKey: string, outcome: 'accepted' | 'rejected', evidence: string) {
  z.enum(['accepted', 'rejected']).parse(outcome);
  const note = z.string().trim().min(8).max(500).parse(evidence);
  const attempt = await db.deliveryAttempt.findUniqueOrThrow({where:{key:attemptKey,campaignId}});
  if (!attempt.sendId) throw new Error('This attempt has no recoverable operation.');
  const send = await db.cadenceSend.findUnique({where:{id:attempt.sendId,campaignId}});
  if (send) return confirmDeliveryOutcomeAction(campaignId,send.id,outcome,note);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "key" FROM "DeliveryAttempt" WHERE "key" = ${attemptKey} FOR UPDATE`;
    const fresh = await tx.deliveryAttempt.findUniqueOrThrow({where:{key:attemptKey,campaignId}});
    if (fresh.status !== 'unknown') throw new Error('Only uncertain provider outcomes require confirmation.');
    const registration = await tx.registrationJob.findUnique({where:{id:fresh.sendId!,campaignId}});
    if (registration) {
      await tx.registrationJob.update({where:{id:registration.id},data:{status:outcome === 'accepted' ? 'completed' : 'pending',completedAt:outcome === 'accepted' ? new Date() : null,claimedAt:null,nextAttemptAt:new Date(),error:null}});
      if (outcome === 'rejected') {
        const {idemKey} = await import('@/lib/idempotency');
        const stage=registration.kind.startsWith('engagement_attended') ? 'Attended' : 'No-show';
        const inner = registration.kind === 'lsq' ? idemKey('lsq-registration',campaignId,registration.contactId) : idemKey('lsq-engagement',campaignId,registration.contactId,stage,registration.kind);
        await tx.appSetting.deleteMany({where:{key:`idem:${inner}`}});
      }
    } else {
      const [id,...parts]=fresh.sendId!.split(':');
      const job=await tx.operationJob.findUniqueOrThrow({where:{id,campaignId,kind:'broadcast'}});
      const payload=JSON.parse(job.payloadJson) as {contactIds:string[]};
      const key=parts.join(':');
      const index=payload.contactIds.indexOf(parts[0]);
      if (index < 0) throw new Error('Broadcast recipient does not belong to this operation.');
      const results=JSON.parse(job.resultJson) as Record<string,{status:string;reason?:string}>;
      if (outcome === 'accepted') results[key]={status:'accepted',reason:`Provider confirmation: ${note}`};
      else delete results[key];
      const cursor=outcome === 'rejected' ? Math.min(job.cursor,index) : job.cursor;
      const problems=Object.values(results).some(r=>r.status==='failed'||r.status==='unknown');
      const status=job.status === 'cancelled' ? 'cancelled' : cursor < job.total ? 'pending' : problems ? 'needs_attention' : 'completed';
      await tx.operationJob.update({where:{id},data:{cursor,status,resultJson:JSON.stringify(results),error:problems?'Some deliveries still require review.':null,claimedAt:null}});
    }
    await tx.deliveryAttempt.update({where:{key:attemptKey},data:{status:outcome==='accepted'?'accepted':'failed',receiptJson:JSON.stringify({manualConfirmation:note,outcome}),finishedAt:new Date(),error:null}});
    await tx.activityLogEntry.create({data:{campaignId,text:`Provider operation ${fresh.sendId}: confirmed ${outcome}. Evidence: ${note}`,dot:'var(--warning-700)'}});
  });
  if (outcome === 'rejected') {const {releaseSendQuota}=await import('@/lib/sendQuota');await releaseSendQuota(campaignId,'',attempt.sendId);}
  revalidateCampaign(campaignId);
}
