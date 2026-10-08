import { beforeEach, afterAll, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next/server', async original => ({ ...(await original<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/sendWindow', () => ({ isWithinSendWindow: () => true }));
vi.mock('@/lib/integrationConfig', () => ({ resolveIntegrationField: vi.fn(async () => undefined) }));
vi.mock('@/lib/netcore', async original => ({ ...(await original<typeof import('@/lib/netcore')>()), sendNetcoreEmail: vi.fn(async () => ({ok:true, messageId:'receipt-1'})) }));
vi.mock('@/lib/leadsquared',async original=>({...await original<typeof import('@/lib/leadsquared')>(),sendEmailToLead:vi.fn(async()=>({ok:true})),createOrUpdateLead:vi.fn(async()=>({Message:{Id:'lead-1'}})),getLeadsInList:vi.fn(async()=>[])}));
vi.mock('@/lib/channelDelivery',()=>({getChannelDeliveryMode:vi.fn(async()=> 'direct'),deliverChannelMessage:vi.fn(async()=>({strategyUsed:'direct',detail:'Accepted'})),postSentActivityIfMapped:vi.fn()}));
vi.mock('@/lib/scoringRunner',()=>({runScoringBatch:vi.fn(async()=>({ok:true,scoredCount:25,preservedManualApprovals:0,failedBatches:0}))}));
vi.mock('@/lib/messageTemplates', async original => ({ ...(await original<typeof import('@/lib/messageTemplates')>()), resolveStepTemplate: vi.fn(async () => ({id:'template-1', label:'Invite', channel:'email', subject:'Join {{topic}}', body:'Hello {{firstName}}, join {{topic}}: {{link}}', hidden:false})) }));
import {processBroadcastJob} from '@/lib/broadcast';
import {sendEmailToLead} from '@/lib/leadsquared';
import {deliverChannelMessage} from '@/lib/channelDelivery';
import {confirmOperationOutcomeAction} from '@/lib/actions/jobs';
import {queueAudienceJob,processAudienceJob} from '@/lib/audienceJobs';
import {runScoringBatch} from '@/lib/scoringRunner';
import {runWorkerTick} from '@/lib/workerTick';
import { db } from '@/lib/db';
import { registerContact } from '@/lib/registerContact';
import { mintRegistrationToken } from '@/lib/registration';
import { POST } from '@/app/api/landing/submit/route';
import { GET as calendar } from '@/app/api/calendar/[campaignId]/route';
import { processDueSends,launchCadence } from '@/lib/cadence';
import { sendNetcoreEmail } from '@/lib/netcore';
import { applyAttendance } from '@/lib/attendance';
import { reserveSendQuota, releaseSendQuota, quotaDay } from '@/lib/sendQuota';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import {readFileSync} from 'node:fs';
import { getLaunchReadiness } from '@/lib/launchReadiness';
import { reconcileRecentRegistrations } from '@/lib/registrationReconcile';
import { confirmDeliveryOutcomeAction } from '@/lib/actions/jobs';
import { sendEligibility } from '@/lib/sendEligibility';
import { encryptCredential, decryptCredential } from '@/lib/credentialCipher';
import { isPrivateAddress } from '@/lib/safeFetch';
const ids: string[] = [];
let cid = '';
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(resolveIntegrationField).mockResolvedValue(undefined);
  const c = await db.campaign.create({data:{ name:'Reliability regression',vertical:'Test',date:'Future',scheduledAt:new Date(Date.now()+7*864e5),emailProvider:'netcore',cadenceStatus:'running',status:'live',scheduleWindow:'00:00-23:59',msgMode:'templatized',dailyLimit:100,timezone:'America/New_York',zoomLink:'https://zoom.example/j/general',launchedAt:new Date() }});
  cid=c.id;ids.push(cid);
});
afterAll(async()=>{
  await db.operationJob.deleteMany({where:{campaignId:{in:ids}}});await db.deliveryAttempt.deleteMany({where:{campaignId:{in:ids}}});await db.dailySendBudget.deleteMany({where:{campaignId:{in:ids}}});await db.sendQuotaReservation.deleteMany({where:{campaignId:{in:ids}}});await db.campaign.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
});
async function contact(email: string, data: Record<string,unknown> = {}) {
  return db.contact.create({data:{campaignId:cid,name:'Test Person',account:'Example',title:'Director',function:'Marketing',seniority:'Director',vertical:'Test',email,approved:true,...data}});
}
async function invite(c: Awaited<ReturnType<typeof contact>>) {
  await db.cadenceStep.upsert({where:{campaignId_key:{campaignId:cid,key:'invite'}},create:{campaignId:cid,key:'invite',title:'Invite',timing:'Now',channel:'Email',desc:'Invite',group:'Pre-registration',trigger:'launch',mode:'template'},update:{}});
  return db.cadenceSend.create({data:{campaignId:cid,contactId:c.id,stepKey:'invite',dueAt:new Date(Date.now()-1000)}});
}
const submit=(data:Record<string,unknown>)=>POST(new NextRequest('https://studio.example/api/landing/submit',{method:'POST',body:JSON.stringify({campaignId:cid,...data}),headers:{'content-type':'application/json','x-forwarded-for':`192.0.2.${Math.floor(Math.random()*200)+1}`}}));
it('serializes competing reservations for the final seat',async()=>{
  await db.campaign.update({where:{id:cid},data:{capacity:1}});const a=await contact('a@example.com'),b=await contact('b@example.com');
  const r=await Promise.all([a,b].map(c=>registerContact(cid,c.id,'website',undefined,{enforceAvailability:true})));
  expect(r.filter(v=>v.ok)).toHaveLength(1);expect(await db.contact.count({where:{campaignId:cid,registeredAt:{not:null}}})).toBe(1);expect((await db.campaign.findUniqueOrThrow({where:{id:cid}})).registrations).toBe(1);
});
it('normalizes campaign email identity at the database boundary',async()=>{
  await contact(' Person@Example.COM ');await expect(contact('person@example.com')).rejects.toMatchObject({code:'P2002'});
});
it('concurrent public submissions create one registered contact',async()=>{
  const r=await Promise.all([submit({email:'same@example.com'}),submit({email:'SAME@example.com'})]);expect(r.map(x=>x.status)).toEqual([200,200]);expect(await db.contact.count({where:{campaignId:cid,email:'same@example.com'}})).toBe(1);
});
it('never returns a bearer token or personal join URL for email-only submissions',async()=>{
  await contact('registered@example.com',{registeredAt:new Date(),zoomJoinUrl:'https://zoom.example/private'});const json=await (await submit({email:'registered@example.com'})).json();expect(json.ok).toBe(true);expect(json.token).toBeUndefined();expect(json.joinUrl).toBeUndefined();expect(json.calendar).toBeUndefined();
});
it('does not create audience records when registration is closed',async()=>{
  await db.campaign.update({where:{id:cid},data:{archived:true}});expect((await submit({email:'late@example.com'})).status).toBe(409);expect(await db.contact.count({where:{campaignId:cid}})).toBe(0);
});
it('rejects an invalid token rather than falling back to email',async()=>{expect((await submit({token:'invalid',email:'new@example.com'})).status).toBe(400);expect(await db.contact.count({where:{campaignId:cid}})).toBe(0);});
it('records organic registrants without invented scores or Apollo attribution',async()=>{await submit({email:'organic@example.com'});const c=await db.contact.findFirstOrThrow({where:{campaignId:cid}});expect(c.score).toBeNull();expect(c.source).toBe('Website Registration');expect(c.approved).toBe(false);});
it('commits follow-up jobs with registration and does not duplicate them',async()=>{
  await db.campaign.update({where:{id:cid},data:{zoomMeetingId:'123',lsqSuppressionListId:'456'}});const c=await contact('durable@example.com');await registerContact(cid,c.id,'website');await registerContact(cid,c.id,'website');const jobs=await db.registrationJob.findMany({where:{contactId:c.id}});expect(jobs.map(j=>j.kind).sort()).toEqual(['lsq','suppression','zoom']);expect(jobs.every(j=>j.status==='pending')).toBe(true);
});
it('continues reconciliation beyond the first 50 healthy registrations',async()=>{
  const people=await Promise.all(Array.from({length:51},(_,i)=>contact(`fair${i}@example.com`,{registeredAt:new Date()})));
  await db.registrationJob.createMany({data:people.slice(0,50).map(c=>({campaignId:cid,contactId:c.id,kind:'lsq',status:'completed'}))});await reconcileRecentRegistrations({limit:50,budgetMs:100});expect(await db.registrationJob.findUnique({where:{contactId_kind:{contactId:people[50].id,kind:'lsq'}}})).toBeTruthy();
});
it('shares quota atomically across workers and does not charge replay twice',async()=>{
  const result=await Promise.all(Array.from({length:15},(_,i)=>reserveSendQuota(cid,'2026-10-07',3,0,`${cid}-${i}`)));expect(result.filter(Boolean)).toHaveLength(3);
  const first=result.findIndex(Boolean);expect(await reserveSendQuota(cid,'2026-10-07',3,0,`${cid}-${first}`)).toBe(true);expect((await db.dailySendBudget.findUniqueOrThrow({where:{campaignId_day:{campaignId:cid,day:'2026-10-07'}}})).used).toBe(3);
  await releaseSendQuota(cid,'2026-10-07',`${cid}-${first}`);await releaseSendQuota(cid,'2026-10-07',`${cid}-${first}`);expect((await db.dailySendBudget.findUniqueOrThrow({where:{campaignId_day:{campaignId:cid,day:'2026-10-07'}}})).used).toBe(2);
});
it('uses the campaign timezone around a UTC midnight',()=>{expect(quotaDay(new Date('2026-10-07T01:00:00Z'),'America/New_York')).toBe('2026-10-06');expect(quotaDay(new Date('2026-10-07T01:00:00Z'),'Asia/Kolkata')).toBe('2026-10-07');});
it('pause after one accepted message prevents the rest of the batch',async()=>{
  await invite(await contact('pause1@example.com'));await invite(await contact('pause2@example.com'));
  vi.mocked(sendNetcoreEmail).mockImplementationOnce(async()=>{await db.campaign.update({where:{id:cid},data:{cadenceStatus:'paused'}});return {ok:true,messageId:'first'};});await processDueSends(cid);expect(sendNetcoreEmail).toHaveBeenCalledTimes(1);expect(await db.cadenceSend.count({where:{campaignId:cid,status:'sent'}})).toBe(1);expect(await db.cadenceSend.count({where:{campaignId:cid,status:'queued'}})).toBe(1);
});
it('refreshes consent immediately before dispatch',async()=>{
  const a=await contact('consent1@example.com'),b=await contact('consent2@example.com');await invite(a);await invite(b);
  vi.mocked(sendNetcoreEmail).mockImplementationOnce(async()=>{await db.contact.update({where:{id:b.id},data:{unsubscribedAt:new Date()}});return {ok:true,messageId:'first'};});await processDueSends(cid);expect(sendNetcoreEmail).toHaveBeenCalledTimes(1);expect(await db.cadenceSend.count({where:{campaignId:cid,status:'skipped'}})).toBe(1);
});
it('preserves uncertain outcomes and does not silently replay them',async()=>{
  const s=await invite(await contact('unknown@example.com'));vi.mocked(sendNetcoreEmail).mockRejectedValueOnce(new Error('Response lost'));await processDueSends(cid);expect((await db.cadenceSend.findUniqueOrThrow({where:{id:s.id}})).status).toBe('unknown');
  await db.cadenceSend.update({where:{id:s.id},data:{status:'queued'}});await processDueSends(cid);expect(sendNetcoreEmail).toHaveBeenCalledTimes(1);
});
it('stores the actual recipient, rendered content, and provider receipt',async()=>{
  const s=await invite(await contact('history@example.com'));await processDueSends(cid);const row=await db.cadenceSend.findUniqueOrThrow({where:{id:s.id}});expect(row.recipient).toBe('history@example.com');expect(row.renderedBody).toContain('Hello Test');expect(row.renderedSubject).toContain('Reliability');expect(row.providerMessageId).toBe('receipt-1');expect(row.deliveryOutcome).toBe('accepted');
});
it('blocks launch when provider configuration is missing',async()=>{await invite(await contact('launch@example.com'));const r=await getLaunchReadiness(cid);expect(r.ok).toBe(false);expect(r.problems.join(' ')).toContain('netcore.apiKey');});
it('applies campaign exclusions to phone channels as well',async()=>{
  const c=await contact('excluded@example.com',{phone:'+919876543210',whatsappOptIn:true});await db.campaignSuppression.create({data:{campaignId:cid,email:'excluded@example.com'}});expect((await sendEligibility(cid,c,'sms')).ok).toBe(false);expect((await sendEligibility(cid,c,'whatsapp')).ok).toBe(false);
});
it('calendar requires a valid attendee link and uses its personal join URL and duration',async()=>{
  const c=await contact('calendar@example.com',{registeredAt:new Date(),zoomJoinUrl:'https://zoom.example/personal'});await db.campaign.update({where:{id:cid},data:{durationMinutes:90,zoomMeetingId:'123',scheduledAt:new Date('2026-11-01T12:00:00Z')}});const ctx={params:Promise.resolve({campaignId:cid})};
  expect((await calendar(new Request(`https://studio.example/api/calendar/${cid}?email=${c.email}`),ctx)).status).toBe(404);
  const r=await calendar(new Request(`https://studio.example/api/calendar/${cid}?t=${mintRegistrationToken(cid,c.id)}`),ctx);const body=await r.text();expect(body).toContain('https://zoom.example/personal');expect(body).toContain('DTEND:20261101T133000Z');expect(r.headers.get('cache-control')).toBe('private, no-store');
});
it('queues custom attendance steps and supports corrections without duplicate sends',async()=>{
  const a=await contact('attendee@example.com',{registeredAt:new Date(),approved:false});const b=await contact('noshow@example.com',{registeredAt:new Date()});await db.cadenceStep.create({data:{campaignId:cid,key:'customAttendance',title:'Thanks',timing:'Now',channel:'Email',desc:'Custom',group:'Post-webinar',trigger:'attendance',anchor:'event',offsetValue:0,audience:'attended'}});
  await applyAttendance(cid,new Map([[a.email!,10]]));expect((await db.contact.findUniqueOrThrow({where:{id:a.id}})).attended).toBe(true);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:a.id}})).toBe(1);
  await applyAttendance(cid,new Map([[a.email!,10]]));expect((await db.campaign.findUniqueOrThrow({where:{id:cid}})).attendanceVersion).toBe(1);
  await applyAttendance(cid,new Map([[b.email!,5]]));expect((await db.contact.findUniqueOrThrow({where:{id:a.id}})).attended).toBe(false);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:a.id,status:'skipped'}})).toBe(1);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:b.id,status:'queued'}})).toBe(1);
});
it('rolls back a failed attendance import entirely',async()=>{
  const c=await contact('rollback@example.com',{registeredAt:new Date()});await expect(applyAttendance(cid,new Map([[c.email!,NaN]]))).rejects.toThrow();expect((await db.campaign.findUniqueOrThrow({where:{id:cid}})).attendanceImportedAt).toBeNull();expect((await db.contact.findUniqueOrThrow({where:{id:c.id}})).attended).toBe(false);
});
it('refuses cross-campaign delivery confirmation',async()=>{const s=await invite(await contact('scope@example.com'));await expect(confirmDeliveryOutcomeAction('another-campaign',s.id,'accepted','Provider receipt checked')).rejects.toThrow();});
it('encrypts credentials and detects tampering',()=>{const encrypted=encryptCredential('secret-provider-value');expect(encrypted).not.toContain('secret-provider-value');expect(decryptCredential(encrypted)).toBe('secret-provider-value');const raw=Buffer.from(encrypted.slice(7),'base64');raw[15]^=1;expect(()=>decryptCredential('enc:v1:'+raw.toString('base64'))).toThrow();});
it.each(['::ffff:7f00:1','fe90::1','169.254.169.254','10.0.0.1','fc00::1'])('rejects non-public addresses: %s',ip=>expect(isPrivateAddress(ip)).toBe(true));

async function broadcast(input:Record<string,unknown>={channel:'email',message:'Hello {{firstName}}, join {{zoomLink}}.'}) {
 const people=await db.contact.findMany({where:{campaignId:cid,registeredAt:{not:null}},orderBy:{id:'asc'},select:{id:true}});
 return db.operationJob.create({data:{campaignId:cid,kind:'broadcast',total:people.length,payloadJson:JSON.stringify({input,contactIds:people.map(c=>c.id)})}});
}
it('LeadSquared broadcasts actually dispatch personalized email and preserve receipts',async()=>{
 await db.campaign.update({where:{id:cid},data:{emailProvider:'leadsquared'}});
 await contact('broadcast@example.com',{registeredAt:new Date(),zoomJoinUrl:'https://zoom.example/personal-broadcast'});
 const job=await broadcast();const result=await processBroadcastJob(job.id);
 expect(result.sentCount).toBe(1);expect(sendEmailToLead).toHaveBeenCalledWith(expect.objectContaining({recipientEmail:'broadcast@example.com',contentText:expect.stringContaining('https://zoom.example/personal-broadcast')}));
 expect(await db.deliveryAttempt.count({where:{campaignId:cid,status:'accepted'}})).toBe(1);
});
it('broadcasts refuse opted-out contacts across phone channels',async()=>{
 await contact('broadcast-optout@example.com',{registeredAt:new Date(),phone:'+919876543210',unsubscribedAt:new Date(),whatsappOptIn:true});
 const job=await broadcast({channel:'all',message:'Reminder'});const result=await processBroadcastJob(job.id);
 expect(result.skippedCount).toBe(3);expect(deliverChannelMessage).not.toHaveBeenCalled();expect(sendNetcoreEmail).not.toHaveBeenCalled();
});
it('broadcast pause is respected before the next recipient',async()=>{
 await contact('broadcast-pause1@example.com',{registeredAt:new Date()});await contact('broadcast-pause2@example.com',{registeredAt:new Date()});
 vi.mocked(sendNetcoreEmail).mockImplementationOnce(async()=>{await db.campaign.update({where:{id:cid},data:{cadenceStatus:'paused'}});return {ok:true,messageId:'pause-receipt'};});
 const result=await processBroadcastJob((await broadcast()).id);expect(result.sentCount).toBe(1);expect(result.queuedCount).toBe(1);expect(result.status).toBe('pending');
});
it('holds an uncertain broadcast until provider evidence authorizes retry',async()=>{
 await contact('broadcast-unknown@example.com',{registeredAt:new Date()});const job=await broadcast();vi.mocked(sendNetcoreEmail).mockRejectedValueOnce(new Error('Response lost'));
 expect((await processBroadcastJob(job.id)).status).toBe('needs_attention');await processBroadcastJob(job.id);expect(sendNetcoreEmail).toHaveBeenCalledTimes(1);
 const attempt=await db.deliveryAttempt.findFirstOrThrow({where:{campaignId:cid}});
 await confirmOperationOutcomeAction(cid,attempt.key,'rejected','Provider dashboard confirms no message accepted');
 expect((await db.dailySendBudget.findFirstOrThrow({where:{campaignId:cid}})).used).toBe(0);
 expect((await processBroadcastJob(job.id)).sentCount).toBe(1);expect(sendNetcoreEmail).toHaveBeenCalledTimes(2);
});
it('audience scoring resumes from its committed batch cursor',async()=>{
 await db.campaign.update({where:{id:cid},data:{status:'draft',cadenceStatus:'not_started'}});
 await Promise.all(Array.from({length:30},(_,i)=>contact(`score${i}@example.com`)));
 const result=await queueAudienceJob(cid,'scoring');expect(result.queuedCount).toBe(5);expect(result.scoredCount).toBe(25);
 vi.mocked(runScoringBatch).mockResolvedValueOnce({ok:true,scoredCount:5,preservedManualApprovals:0,failedBatches:0});await processAudienceJob(result.jobId!);
 const job=await db.operationJob.findUniqueOrThrow({where:{id:result.jobId}});expect(job.status).toBe('completed');expect(job.cursor).toBe(30);expect(vi.mocked(runScoringBatch).mock.calls.at(-1)?.[1]).toHaveLength(5);
});
it('serializes duplicate audience job submissions',async()=>{
 await db.campaign.update({where:{id:cid},data:{status:'draft',cadenceStatus:'not_started'}});await Promise.all(Array.from({length:26},(_,i)=>contact(`enqueue${i}@example.com`)));
 const result=await Promise.all([queueAudienceJob(cid,'scoring'),queueAudienceJob(cid,'scoring')]);expect(result[0].jobId).toBe(result[1].jobId);expect(await db.operationJob.count({where:{campaignId:cid,kind:'scoring'}})).toBe(1);
});
it('refuses a second worker while a database lease is held',async()=>{
 await db.workerLease.upsert({where:{name:'cadence'},create:{name:'cadence',owner:'regression',expiresAt:new Date(Date.now()+60000)},update:{owner:'regression',expiresAt:new Date(Date.now()+60000)}});
 try{expect(await runWorkerTick()).toMatchObject({skipped:expect.stringContaining('Another worker')});}finally{await db.workerLease.deleteMany({where:{name:'cadence',owner:'regression'}});}
});
it('SMS broadcasts respect channel-specific STOP even without global unsubscribe',async()=>{
 await contact('sms-stop@example.com',{registeredAt:new Date(),phone:'+919876543210',smsOptOut:true});const result=await processBroadcastJob((await broadcast({channel:'sms',message:'Reminder'})).id);expect(result.skippedCount).toBe(1);expect(deliverChannelMessage).not.toHaveBeenCalled();
});
it('post-event reporting includes organic registrants without approval and measures zero watch time',async()=>{
 const {getPostEventStats,getAccountEngagement}=await import('@/lib/postEvent');
 const a=await contact('organic-attendance@example.com',{registeredAt:new Date(),approved:false,attended:true,watchMinutes:0});
 await contact('organic-noshow@example.com',{registeredAt:new Date(),approved:false});
 const stats=await getPostEventStats(cid);expect(stats.registered).toBe(2);expect(stats.attended).toBe(1);expect(stats.avgWatchMinutes).toBe(0);
 const accounts=await getAccountEngagement(cid);expect(accounts[0].contactCount).toBe(2);expect(accounts[0].topContactId).toBe(a.id);expect(accounts[0].attended).toBe(1);
});

it('registration repair tolerates contacts being deleted concurrently',async()=>{
 for(let round=0;round<5;round++){
  const people=await Promise.all(Array.from({length:10},(_,i)=>contact(`deletion-race-${round}-${i}@example.com`,{registeredAt:new Date()})));
  await Promise.all([reconcileRecentRegistrations({limit:100,budgetMs:0}),db.contact.deleteMany({where:{id:{in:people.map(c=>c.id)}}})]);
  expect(await db.registrationJob.count({where:{contactId:{in:people.map(c=>c.id)}}})).toBe(0);
 }
});

it('unapproved public registrants receive confirmations while stale outreach stays blocked',async()=>{
 await db.campaign.update({where:{id:cid},data:{stopOnRegistration:false,registrationMode:'one_click'}});
 await db.cadenceStep.create({data:{campaignId:cid,key:'confirm',title:'Confirmation',timing:'Now',channel:'Email',desc:'Registration confirmation',group:'Registered',trigger:'registration',mode:'template'}});
 await submit({email:'organic-confirmation@example.com'});const c=await db.contact.findFirstOrThrow({where:{campaignId:cid,email:'organic-confirmation@example.com'}});expect(c.approved).toBe(false);await invite(c);const result=await processDueSends(cid,5000);expect(result.sent).toBe(1);
 expect(await db.cadenceSend.findUnique({where:{campaignId_contactId_stepKey:{campaignId:cid,contactId:c.id,stepKey:'confirm'}}})).toMatchObject({status:'sent'});expect(await db.cadenceSend.findUnique({where:{campaignId_contactId_stepKey:{campaignId:cid,contactId:c.id,stepKey:'invite'}}})).toMatchObject({status:'skipped',error:'Contact is not approved for outreach.'});
});
it('launch queues countdown reminders for registered contacts without approving them for outreach',async()=>{
 await db.campaign.update({where:{id:cid},data:{cadenceStatus:'not_started',status:'draft'}});
 vi.mocked(resolveIntegrationField).mockResolvedValue('test-only-config');
 await db.messageTemplate.createMany({data:['invite','t1d','customReminder'].map(key=>({campaignId:cid,key,name:key,channel:'email',subject:'Join {{topic}}',body:'Hello {{firstName}}, join {{topic}}: {{link}}'}))});
 const inbound=await contact('inbound-before-launch@example.com',{approved:false,registeredAt:new Date()});await contact('approved-before-launch@example.com');
 await db.cadenceStep.createMany({data:[{campaignId:cid,key:'invite',title:'Invite',timing:'Now',channel:'Email',desc:'Invite',group:'Pre-registration',trigger:'launch',mode:'template'},{campaignId:cid,key:'t1d',title:'Tomorrow',timing:'Tomorrow',channel:'Email',desc:'Registered countdown',group:'Reminders',trigger:'launch',mode:'template',anchor:'webinar',offsetValue:-1,offsetUnit:'days'},{campaignId:cid,key:'customReminder',title:'Custom countdown',timing:'Tomorrow',channel:'Email',desc:'Registered countdown',group:'Reminders',trigger:'launch',mode:'template',anchor:'webinar',offsetValue:-1,offsetUnit:'days'}]});
 await launchCadence(cid);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:inbound.id,stepKey:'customReminder'}})).toBe(1);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:inbound.id,stepKey:'t1d'}})).toBe(1);expect(await db.cadenceSend.count({where:{campaignId:cid,contactId:inbound.id,stepKey:'invite'}})).toBe(0);expect((await db.contact.findUniqueOrThrow({where:{id:inbound.id}})).approved).toBe(false);
});

it('corrects legacy inbound approval without changing manual, scored, or imported audience decisions',async()=>{
 const inbound=await contact('legacy-inbound@example.com',{source:'Website Registration',registeredAt:new Date(),score:null});
 const manual=await contact('manual-inbound@example.com',{source:'Website Registration',registeredAt:new Date(),score:null,approvedManually:true});
 const scored=await contact('scored-inbound@example.com',{source:'Website Registration',registeredAt:new Date(),score:85});
 const imported=await contact('imported-approved@example.com',{source:'CSV Import',registeredAt:new Date(),score:null});
 await db.$executeRawUnsafe(readFileSync('prisma/migrations/20261008000000_correct_inbound_approval/migration.sql','utf8'));
 expect((await db.contact.findUniqueOrThrow({where:{id:inbound.id}})).approved).toBe(false);
 for(const record of [manual,scored,imported])expect((await db.contact.findUniqueOrThrow({where:{id:record.id}})).approved).toBe(true);
});
