import { beforeEach, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>({contacts:[] as Array<Record<string,unknown>>,jobs:[] as Array<Record<string,unknown>>,configured:true,removed:false,cascadeOnLookup:false}));
vi.mock('@/lib/db',()=>{const mockDb={
 $queryRaw:vi.fn(async()=>mocks.removed?[]:mocks.contacts.flatMap(c=>[{id:c.id},{id:c.campaignId}])),
 contact:{findMany:vi.fn(async()=>mocks.contacts),findUnique:vi.fn(async({where})=>{if(mocks.cascadeOnLookup){mocks.jobs=[];return null;}return mocks.jobs.find(j=>j.id==='job')?.contact ?? mocks.jobs.find(j=>j.contactId===where.id)?.contact;})},
 registrationJob:{
  createMany:vi.fn(async({data})=>{mocks.jobs.push(...data.map((d:Record<string,unknown>,i:number)=>({...d,id:`job-${i}`,status:'pending',attempts:0,contact:mocks.contacts.find(c=>c.id===d.contactId)})));return {count:data.length};}),
  findMany:vi.fn(async()=>mocks.jobs.filter(j=>['pending','blocked','failed'].includes(j.status as string))),
  updateMany:vi.fn(async({where,data})=>{if(!where.id)return {count:0};const j=mocks.jobs.find(j=>j.id===where.id);if(!j)return {count:0};Object.assign(j,data);return {count:1};}),
  update:vi.fn(async({where,data})=>{const j=mocks.jobs.find(j=>j.id===where.id)!;Object.assign(j,data);return j;}),
 }
};return {db:{...mockDb,$transaction:vi.fn(async(run:(tx:typeof mockDb)=>Promise<unknown>)=>run(mockDb))}};});
vi.mock('@/lib/integrationConfig',()=>({resolveIntegrationField:vi.fn(async()=>mocks.configured?'configured':undefined)}));
vi.mock('@/lib/zoom/client',()=>({zoomIsConfigured:vi.fn(async()=>mocks.configured)}));
vi.mock('@/lib/zoomRegistration',()=>({syncRegistrantToZoom:vi.fn(async()=>({ok:true,joinUrl:'https://zoom.example/personal'}))}));
vi.mock('@/lib/activityPush',()=>({postWebinarRegistrationActivity:vi.fn(async()=>({ok:true,activityId:123}))}));
vi.mock('@/lib/lsqSuppression',()=>({syncContactToLsqSuppressionList:vi.fn(async()=>true)}));
vi.mock('@/lib/deliveryGuard',async original=>({...await original<typeof import('@/lib/deliveryGuard')>(),deliverOnce:vi.fn(async(_id,_kind,deliver)=>({duplicate:false,value:await deliver()}))}));
import { db } from '@/lib/db';
import { reconcileRecentRegistrations } from './registrationReconcile';
import { processRegistrationJobs } from './registrationJobs';
import { syncRegistrantToZoom } from './zoomRegistration';
import { postWebinarRegistrationActivity } from './activityPush';
import { syncContactToLsqSuppressionList } from './lsqSuppression';
const person=(over:Record<string,unknown>={})=>({id:'person',campaignId:'campaign',name:'Ann Lee',email:'ann@example.com',registrationSource:'email',zoomJoinUrl:'https://zoom.example/personal',registrationJobs:[],campaign:{id:'campaign',zoomMeetingId:null,lsqSuppressionListId:null},...over});
const job=(kind:string,over:Record<string,unknown>={})=>({id:'job',contactId:'person',campaignId:'campaign',kind,status:'pending',attempts:0,contact:person(),...over});
beforeEach(()=>{vi.clearAllMocks();mocks.contacts=[];mocks.jobs=[];mocks.configured=true;mocks.removed=false;mocks.cascadeOnLookup=false;vi.mocked(syncRegistrantToZoom).mockResolvedValue({ok:true,joinUrl:'https://zoom.example/personal'});vi.mocked(postWebinarRegistrationActivity).mockResolvedValue({ok:true,activityId:123});vi.mocked(syncContactToLsqSuppressionList).mockResolvedValue(true);});
it('does nothing when no work exists',async()=>expect((await reconcileRecentRegistrations()).checked).toBe(0));
it('queries missing jobs without a lookback cutoff',async()=>{await reconcileRecentRegistrations({limit:25});expect(db.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({take:25,where:expect.objectContaining({registeredAt:{not:null}})}));});
it('backfills every required side effect',async()=>{mocks.contacts=[person({zoomJoinUrl:null,campaign:{id:'campaign',zoomMeetingId:'123',lsqSuppressionListId:'456'}})];await reconcileRecentRegistrations({budgetMs:0});expect(mocks.jobs.map(j=>j.kind).sort()).toEqual(['lsq','suppression','zoom']);});
it('does not echo registrations originating from LeadSquared',async()=>{mocks.contacts=[person({registrationSource:'leadsquared'})];await reconcileRecentRegistrations();expect(mocks.jobs).toHaveLength(0);expect(postWebinarRegistrationActivity).not.toHaveBeenCalled();});
it('does not recreate completed jobs',async()=>{mocks.contacts=[person({registrationJobs:[{kind:'lsq'}]})];await reconcileRecentRegistrations();expect(db.registrationJob.createMany).not.toHaveBeenCalled();});
it('processes a pending Zoom job and stores completion',async()=>{mocks.jobs=[job('zoom')];expect((await processRegistrationJobs()).zoomFixed).toBe(1);expect(mocks.jobs[0].status).toBe('completed');});
it('keeps unconfigured integrations visibly blocked',async()=>{mocks.configured=false;mocks.jobs=[job('zoom')];await processRegistrationJobs();expect(mocks.jobs[0].status).toBe('blocked');expect(syncRegistrantToZoom).not.toHaveBeenCalled();});
it('backs off a failed Zoom registration',async()=>{mocks.jobs=[job('zoom')];vi.mocked(syncRegistrantToZoom).mockResolvedValueOnce({ok:false,error:'capacity'});await processRegistrationJobs();expect(mocks.jobs[0].status).toBe('failed');expect(mocks.jobs[0].nextAttemptAt).toBeInstanceOf(Date);});
it('waits for the personal join URL before posting to CRM',async()=>{mocks.jobs=[job('lsq',{contact:person({zoomJoinUrl:null,campaign:{zoomMeetingId:'123'}})})];await processRegistrationJobs();expect(mocks.jobs[0].status).toBe('blocked');expect(postWebinarRegistrationActivity).not.toHaveBeenCalled();});
it('completes a confirmed CRM registration activity',async()=>{mocks.jobs=[job('lsq')];expect((await processRegistrationJobs()).lsqFixed).toBe(1);expect(mocks.jobs[0].status).toBe('completed');});
it('completes suppression synchronization only when the provider confirms it',async()=>{mocks.jobs=[job('suppression')];vi.mocked(syncContactToLsqSuppressionList).mockResolvedValueOnce(false);expect((await processRegistrationJobs()).suppressionFixed).toBe(0);expect(mocks.jobs[0].status).toBe('failed');});
it('continues other jobs after one fails',async()=>{mocks.jobs=[job('zoom'),job('suppression',{id:'second'})];vi.mocked(syncRegistrantToZoom).mockRejectedValueOnce(new Error('Timeout'));const r=await processRegistrationJobs();expect(r.checked).toBe(2);expect(r.suppressionFixed).toBe(1);});

it('skips a contact removed between reconciliation discovery and parent-row locking',async()=>{mocks.contacts=[person()];mocks.removed=true;await reconcileRecentRegistrations({budgetMs:0});expect(db.registrationJob.createMany).not.toHaveBeenCalled();});
it('continues safely when deletion cascades a claimed job before contact lookup',async()=>{mocks.jobs=[job('zoom')];mocks.cascadeOnLookup=true;await expect(processRegistrationJobs()).resolves.toMatchObject({checked:1,zoomRetried:0});expect(syncRegistrantToZoom).not.toHaveBeenCalled();});
