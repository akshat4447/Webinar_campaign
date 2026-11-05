import { db } from '@/lib/db';
import { appOrigin } from '@/lib/appOrigin';
import { registrationModeOf, buildPublicLandingUrl, publicRegistrationUrl } from '@/lib/inviteLink';
import { registrationChannelSql, registrationSourceSql } from '@/lib/registrationChannelSql';
import { normalizeChannel } from '@/lib/channels';
import { isOutreachStep } from '@/lib/stepTrigger';
import { AUTOMATIC_CHANNELS,DEFAULT_SELECTED_CHANNELS,CHANNEL_DEFINITIONS,parseSelectedChannels,withAutomaticChannels,type RegistrationChannelKey,type ChannelRegistrationStat,type CampaignRegistrationOverview } from './registrationChannels';
export * from './registrationChannels';

export async function getCampaignRegistrationChannels(campaignId:string,origin=appOrigin()):Promise<CampaignRegistrationOverview>{
 const campaign=await db.campaign.findUnique({where:{id:campaignId},select:{id:true,name:true,registrationLink:true,registrationMode:true,oneClickSignup:true,zoomMeetingId:true,zoomLink:true,registrations:true,selectedChannels:true,status:true}});
 if(!campaign)return {totalRegistered:0,untrackedRegistered:0,selectedChannels:DEFAULT_SELECTED_CHANNELS,channels:[],topChannel:null};
 type Sample=ChannelRegistrationStat['contacts'][number]&{channel:RegistrationChannelKey;channelCount:number};
 const [samples,invitedByKey]=await Promise.all([
  db.$queryRaw<Sample[]>`WITH sources AS (SELECT *,${registrationSourceSql} FROM "Contact" WHERE "campaignId"=${campaignId} AND "registeredAt" IS NOT NULL),
   classified AS (SELECT c.id,c.name,c.email,c.phone,c.account,c.title,c."registeredAt",c.score,c."zoomJoinUrl",${registrationChannelSql} AS channel FROM sources c),
   ranked AS (SELECT *,count(*) OVER(PARTITION BY channel)::int AS "channelCount",row_number() OVER(PARTITION BY channel ORDER BY score DESC NULLS LAST,id) AS rank FROM classified)
   SELECT id,name,email,phone,account,title,"registeredAt",score,"zoomJoinUrl",channel,"channelCount" FROM ranked WHERE rank<=50 ORDER BY channel,rank`,
  invitedByChannel(campaignId),
 ]);
 const counts=new Map(samples.map(c=>[c.channel,c.channelCount]));
 const recordedRegistered=[...counts.values()].reduce((sum,n)=>sum+n,0);
 const totalRegistered=recordedRegistered||((campaign.status==='completed'||campaign.status==='ended')?campaign.registrations||0:0);
 const selectedKeys=parseSelectedChannels(campaign.selectedChannels);
 // The channels Studio links itself are always tracked, whatever an older selection says; a shared channel shows when it is on or has registrations.
 const listed=withAutomaticChannels(selectedKeys);
 const activeKeys=[...listed,...DEFAULT_SELECTED_CHANNELS.filter(k=>!listed.includes(k)&&(counts.get(k)||0)>0)];
 const mode=registrationModeOf(campaign);
 const channels:ChannelRegistrationStat[]=activeKeys.map(key=>{
  const def=CHANNEL_DEFINITIONS[key];const registeredCount=counts.get(key)||0;const invitedCount=invitedByKey.get(key)||0;
  return {key,label:def.label,icon:def.icon,color:def.color,description:def.description,category:def.category,registeredCount,pctOfTotal:totalRegistered?Math.round(registeredCount/totalRegistered*100):0,invitedCount,conversionRate:invitedCount?Math.round(registeredCount/invitedCount*100):null,trackingUrl:AUTOMATIC_CHANNELS.includes(key)?null:mode==='external'&&campaign.registrationLink?buildPublicLandingUrl({landingPageUrl:campaign.registrationLink,campaign,channel:key}):publicRegistrationUrl(origin,campaign.id,key),contacts:samples.filter(c=>c.channel===key).map(c=>({id:c.id,name:c.name,email:c.email,phone:c.phone,account:c.account,title:c.title,registeredAt:c.registeredAt,score:c.score,zoomJoinUrl:c.zoomJoinUrl}))};
 });
 return {totalRegistered,untrackedRegistered:Math.max(0,totalRegistered-recordedRegistered),selectedChannels:selectedKeys,channels,topChannel:[...channels].filter(c=>c.registeredCount>0).sort((a,b)=>b.registeredCount-a.registeredCount)[0]||null};
}

const CHANNEL_KEY:Record<string,RegistrationChannelKey>={email:'email_campaign',sms:'sms',whatsapp:'whatsapp',linkedin:'linkedin'};
/** The built-in invite steps, for sends whose step row no longer exists. */
const BUILT_IN_INVITE_CHANNEL:Record<string,RegistrationChannelKey>={invite:'email_campaign',smsInvite:'sms',waInvite:'whatsapp',linkedin:'linkedin'};

/**
 * How many people were sent an invite on each channel: everyone who was sent any outreach step on it, counted once however many steps
 * reached them. A step the operator added themselves counts, judged by its group and trigger exactly as the rest of Studio judges it,
 * and a step that was removed after it sent still counts for the people it reached.
 */
async function invitedByChannel(campaignId:string):Promise<Map<RegistrationChannelKey,number>>{
 const steps=await db.cadenceStep.findMany({where:{campaignId},select:{key:true,channel:true,group:true,trigger:true}});
 const keysByChannel=new Map<RegistrationChannelKey,Set<string>>();
 const add=(channel:RegistrationChannelKey,key:string)=>{if(!keysByChannel.has(channel))keysByChannel.set(channel,new Set());keysByChannel.get(channel)!.add(key);};
 for(const step of steps)if(isOutreachStep(step))add(CHANNEL_KEY[normalizeChannel(step.channel)],step.key);
 for(const [key,channel] of Object.entries(BUILT_IN_INVITE_CHANNEL))if(!steps.some(s=>s.key===key))add(channel,key);
 const out=new Map<RegistrationChannelKey,number>();
 await Promise.all([...keysByChannel].map(async([channel,keys])=>{
  const rows=await db.cadenceSend.findMany({where:{campaignId,status:'sent',stepKey:{in:[...keys]}},distinct:['contactId'],select:{contactId:true}});
  if(rows.length)out.set(channel,rows.length);
 }));
 return out;
}
