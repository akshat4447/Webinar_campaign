import '@/lib/loadEnv';
import {db} from '@/lib/db';
import {getLeadByEmailAddress,getLeadActivities} from '@/lib/leadsquared';
import {getActivityMap} from '@/lib/channelDelivery';
import {writeFile,mkdir} from 'node:fs/promises';

function summarize(activity: Record<string,unknown>) {
 const fields=(activity.ActivityFields||{}) as Record<string,unknown>;
 return {activityId:activity.ProspectActivityId??activity.Id??activity.ID,event:activity.ActivityEvent??activity.EventCode,eventName:activity.ActivityEventName??activity.EventName,createdOn:activity.CreatedOn,channel:fields.mx_Custom_1,step:fields.mx_Custom_2,message:fields.mx_Custom_3,note:fields.ActivityEvent_Note??activity.ActivityNote};
}
async function main(){
 const email=process.argv[2];if(!email||!email.includes('@'))throw new Error('Supply the designated test email.');
 const lead=await getLeadByEmailAddress(email);if(!lead?.ProspectID)throw new Error('Designated test lead not found.');
 const mapping=await getActivityMap();const shared=Number((await db.appSetting.findUnique({where:{key:'lsq_channel_trigger_activity_type_id'}}))?.value)||null;
 const types=[...new Set([mapping.sms?.typeId||shared,mapping.whatsapp?.typeId||shared].filter((id):id is number=>!!id))];
 const verified:ReturnType<typeof summarize>[]=[],historicalWhatsApp:ReturnType<typeof summarize>[]=[];let scanned=0;
 for(const type of types)for(let offset=0;offset<10;offset++){
  const activities=await getLeadActivities(lead.ProspectID,offset,type);scanned+=activities.length;
  for(const activity of activities){const row=summarize(activity);if(JSON.stringify(activity).includes('operator_verification'))verified.push(row);else if(row.channel==='whatsapp')historicalWhatsApp.push(row);}
  if(activities.length<100)break;
 }
 const report={checkedAt:new Date().toISOString(),designatedEmail:email,leadId:lead.ProspectID,configuredActivityTypes:{sms:mapping.sms?.typeId||shared,whatsapp:mapping.whatsapp?.typeId||shared},scannedActivityRows:scanned,verificationActivities:verified,historicalWhatsAppActivities:historicalWhatsApp,whatsappTestPosted:false,whatsappBlockReason:'Known contact has no recorded WhatsApp opt-in; this test was blocked before posting.',deliveryConfirmed:false,deliveryNote:'CRM activity creation confirms the handoff. Automation and gateway delivery are separate and remain unverified.'};
 await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/lead-activity-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Activity inspection failed');process.exitCode=1;}).finally(()=>db.$disconnect());
