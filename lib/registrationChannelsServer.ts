import { db } from '@/lib/db';
import { appOrigin } from '@/lib/appOrigin';
import { registrationModeOf, buildPublicLandingUrl, publicRegistrationUrl } from '@/lib/inviteLink';
import { registrationChannelSql, registrationSourceSql } from '@/lib/registrationChannelSql';
import { DEFAULT_SELECTED_CHANNELS,CHANNEL_DEFINITIONS,parseSelectedChannels,type RegistrationChannelKey,type ChannelRegistrationStat,type CampaignRegistrationOverview } from './registrationChannels';
export * from './registrationChannels';

export async function getCampaignRegistrationChannels(campaignId:string,origin=appOrigin()):Promise<CampaignRegistrationOverview>{
 const campaign=await db.campaign.findUnique({where:{id:campaignId},select:{id:true,name:true,registrationLink:true,registrationMode:true,oneClickSignup:true,zoomMeetingId:true,zoomLink:true,registrations:true,selectedChannels:true,status:true}});
 if(!campaign)return {totalRegistered:0,untrackedRegistered:0,selectedChannels:DEFAULT_SELECTED_CHANNELS,channels:[],topChannel:null};
 type Sample=ChannelRegistrationStat['contacts'][number]&{channel:RegistrationChannelKey;channelCount:number};
 const [samples,invites]=await Promise.all([
  db.$queryRaw<Sample[]>`WITH sources AS (SELECT *,${registrationSourceSql} FROM "Contact" WHERE "campaignId"=${campaignId} AND "registeredAt" IS NOT NULL),
   classified AS (SELECT c.id,c.name,c.email,c.phone,c.account,c.title,c."registeredAt",c.score,c."zoomJoinUrl",${registrationChannelSql} AS channel FROM sources c),
   ranked AS (SELECT *,count(*) OVER(PARTITION BY channel)::int AS "channelCount",row_number() OVER(PARTITION BY channel ORDER BY score DESC NULLS LAST,id) AS rank FROM classified)
   SELECT id,name,email,phone,account,title,"registeredAt",score,"zoomJoinUrl",channel,"channelCount" FROM ranked WHERE rank<=50 ORDER BY channel,rank`,
  db.$queryRaw<Array<{stepKey:string;count:number}>>`SELECT "stepKey",count(DISTINCT "contactId")::int AS count FROM "CadenceSend" WHERE "campaignId"=${campaignId} AND status='sent' AND "stepKey" IN ('invite','smsInvite','waInvite','linkedin') GROUP BY "stepKey"`,
 ]);
 const counts=new Map(samples.map(c=>[c.channel,c.channelCount]));
 const recordedRegistered=[...counts.values()].reduce((sum,n)=>sum+n,0);
 const totalRegistered=recordedRegistered||((campaign.status==='completed'||campaign.status==='ended')?campaign.registrations||0:0);
 const selectedKeys=parseSelectedChannels(campaign.selectedChannels);
 const activeKeys=[...selectedKeys,...DEFAULT_SELECTED_CHANNELS.filter(k=>!selectedKeys.includes(k)&&(counts.get(k)||0)>0)];
 const stepByChannel:Partial<Record<RegistrationChannelKey,string>>={email_campaign:'invite',whatsapp:'waInvite',linkedin:'linkedin',sms:'smsInvite'};
 const mode=registrationModeOf(campaign);
 const channels:ChannelRegistrationStat[]=activeKeys.map(key=>{
  const def=CHANNEL_DEFINITIONS[key];const registeredCount=counts.get(key)||0;const invitedCount=invites.find(i=>i.stepKey===stepByChannel[key])?.count||0;
  return {key,label:def.label,icon:def.icon,color:def.color,description:def.description,category:def.category,registeredCount,pctOfTotal:totalRegistered?Math.round(registeredCount/totalRegistered*100):0,invitedCount,conversionRate:invitedCount?Math.round(registeredCount/invitedCount*100):null,trackingUrl:mode==='external'&&campaign.registrationLink?buildPublicLandingUrl({landingPageUrl:campaign.registrationLink,campaign,channel:key,appOrigin:origin}):publicRegistrationUrl(origin,campaign.id,key),contacts:samples.filter(c=>c.channel===key).map(c=>({id:c.id,name:c.name,email:c.email,phone:c.phone,account:c.account,title:c.title,registeredAt:c.registeredAt,score:c.score,zoomJoinUrl:c.zoomJoinUrl}))};
 });
 return {totalRegistered,untrackedRegistered:Math.max(0,totalRegistered-recordedRegistered),selectedChannels:selectedKeys,channels,topChannel:[...channels].filter(c=>c.registeredCount>0).sort((a,b)=>b.registeredCount-a.registeredCount)[0]||null};
}
