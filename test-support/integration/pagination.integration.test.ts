import {it,expect,afterAll,vi} from 'vitest';
vi.mock('@/lib/revalidate',()=>({revalidateCampaign:vi.fn()}));
vi.mock('@/lib/channelDelivery',async original=>({...await original<typeof import('@/lib/channelDelivery')>(),postSentActivityIfMapped:vi.fn()}));
import {db} from '@/lib/db';
import {getOverviewData} from '@/lib/overviewData';
import {getCampaignRegistrationChannels,resolveContactRegistrationChannel} from '@/lib/registrationChannelsServer';
import {registrationChannelSql,registrationSourceSql} from '@/lib/registrationChannelSql';
import {getAttendeeChannelBreakdown} from '@/lib/attendeeChannels';
import {dispatchAutomatedLinkedInAction} from '@/lib/actions/linkedin';
import {contactSearch,contactPage,CONTACT_PAGE_SIZE} from '@/lib/contactPagination';
const campaigns:string[]=[];
async function campaign(){const c=await db.campaign.create({data:{name:'Pagination integration',vertical:'Test',date:'Future'}});campaigns.push(c.id);return c.id;}
async function contact(campaignId:string,index:number,extra:Record<string,unknown>={}){return db.contact.create({data:{campaignId,name:`Person ${String(index).padStart(3,'0')}`,email:`person${index}@testing.example`,account:'Example',title:'Director',function:'Marketing',seniority:'Director',vertical:'Test',score:82,approved:true,...extra}});}
afterAll(async()=>{await db.campaign.deleteMany({where:{id:{in:campaigns}}});await db.$disconnect();});
it('caps overview/channel previews while preserving full campaign counts and final-page search',async()=>{
 const id=await campaign();for(let i=0;i<61;i++)await contact(id,i,{registeredAt:new Date(),registrationSource:'whatsapp',attended:i%2===0,enrichedAt:i%3===0?new Date():null});
 const overview=await getOverviewData(id);expect(overview.counts).toMatchObject({total:61,approved:61,registered:61,attended:31,enriched:21});expect(overview.drawers.Imported.rows).toHaveLength(50);expect(overview.drawers.Registered.subtitle).toContain('61 of 61');expect(overview.accountBreakdown[0].contactCount).toBe(61);
 const channels=await getCampaignRegistrationChannels(id);expect(channels.totalRegistered).toBe(61);expect(channels.channels.find(c=>c.key==='whatsapp')).toMatchObject({registeredCount:61,pctOfTotal:100});expect(channels.channels.find(c=>c.key==='whatsapp')?.contacts).toHaveLength(50);
 const page=contactPage('999',61);const contacts=await db.contact.findMany({where:{campaignId:id},take:CONTACT_PAGE_SIZE,skip:(page-1)*CONTACT_PAGE_SIZE,orderBy:[{score:{sort:'desc',nulls:'last'}},{name:'asc'},{id:'asc'}]});expect(contacts).toHaveLength(11);expect(contacts.at(-1)?.email).toBe('person60@testing.example');expect(await db.contact.count({where:{campaignId:id,...contactSearch('PERSON60@TESTING.EXAMPLE')}})).toBe(1);
});
it('matches registration channel precedence for explicit aliases and fallback invite histories in real SQL',async()=>{
 const id=await campaign();const sources=['email','netcore_click','whatsapp','wa','linkedin_event','linkedin-reg','inmail','sales rep','sms','third-parties','partner_newsletter','affiliate/link','framer','landing page','zoom','website','one_click','',null,'unknown'];const expected=new Map<string,string>();
 for(let i=0;i<sources.length;i++){const c=await contact(id,i,{registeredAt:new Date(),registrationSource:sources[i]});const steps=i>=16?['invite','smsInvite','linkedin','waInvite']:[];for(const stepKey of steps)await db.cadenceSend.create({data:{campaignId:id,contactId:c.id,stepKey,dueAt:new Date(),status:'sent'}});expected.set(c.id,resolveContactRegistrationChannel(c,new Map([[c.id,new Set(steps)]])));}
 const rows=await db.$queryRaw<Array<{id:string;channel:string}>>`WITH sources AS(SELECT *,${registrationSourceSql} FROM "Contact" WHERE "campaignId"=${id}) SELECT c.id,${registrationChannelSql} AS channel FROM sources c`;
 for(const row of rows)expect(row.channel).toBe(expected.get(row.id));expect(rows).toHaveLength(sources.length);
});
it('retains overlapping attendee channels without loading all invite/contact records',async()=>{
 const id=await campaign();const a=await contact(id,1,{attended:true}),b=await contact(id,2,{attended:true}),c=await contact(id,3,{attended:false});for(const [contactId,stepKey] of [[a.id,'invite'],[a.id,'waInvite'],[b.id,'invite'],[c.id,'smsInvite']])await db.cadenceSend.create({data:{campaignId:id,contactId,stepKey,dueAt:new Date(),status:'sent'}});
 expect(await getAttendeeChannelBreakdown(id)).toEqual([{label:'Email',attended:2,pctOfAttendees:100},{label:'WhatsApp',attended:1,pctOfAttendees:50}]);
});
it('bulk LinkedIn confirmation affects only the displayed selected IDs',async()=>{
 const id=await campaign();const a=await contact(id,1),b=await contact(id,2);const result=await dispatchAutomatedLinkedInAction(id,[a.id]);expect(result).toMatchObject({ok:true,dispatchedCount:1});expect(await db.cadenceSend.count({where:{campaignId:id,contactId:a.id,status:'sent'}})).toBe(1);expect(await db.cadenceSend.count({where:{campaignId:id,contactId:b.id}})).toBe(0);
});

it('keeps approval comparisons scoped to scored contacts and attendance rates scoped to registrations',async()=>{
 const id=await campaign();await contact(id,1,{registeredAt:new Date(),attended:true});await contact(id,2,{approved:false,registeredAt:new Date(),attended:true});await contact(id,3,{score:null});await contact(id,4,{score:null});
 const data=await getOverviewData(id);expect(data.counts).toMatchObject({total:4,approved:3,scored:2,approvedScored:1});expect(data.scoreBands[0]).toMatchObject({contacts:2,approved:1,registered:2,attended:2,approvalRate:50,attendanceRate:100});expect(data.learningGroups.every(group=>group.rate<=100)).toBe(true);
});

it('counts SMS registrations and invitations separately from SDR/Sales',async()=>{
 const id=await campaign();const sms=await contact(id,1,{registeredAt:new Date(),registrationSource:'sms'});await contact(id,2,{registeredAt:new Date(),registrationSource:'sdr_sales'});await db.cadenceSend.create({data:{campaignId:id,contactId:sms.id,stepKey:'smsInvite',dueAt:new Date(),status:'sent'}});
 const data=await getCampaignRegistrationChannels(id);expect(data.channels.find(c=>c.key==='sms')).toMatchObject({registeredCount:1,invitedCount:1,conversionRate:100});expect(data.channels.find(c=>c.key==='sdr_sales')).toMatchObject({registeredCount:1,invitedCount:0,conversionRate:null});
});
