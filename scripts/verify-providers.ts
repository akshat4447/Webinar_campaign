import '@/lib/loadEnv';
import {writeFile,mkdir} from 'node:fs/promises';
import {db} from '@/lib/db';
import {getIntegrationConfig,INTEGRATION_FIELDS,resolveIntegrationField} from '@/lib/integrationConfig';
import {testIntegrationAction} from '@/lib/actions/integrations';
import {getLeadsMetadata,getLeadByEmailAddress,createOrUpdateLead,sendEmailToLead} from '@/lib/leadsquared';
import {zoomRequest} from '@/lib/zoom/client';
import {sendNetcoreEmail,isEmailSuppressed} from '@/lib/netcore';
import {getChannelDeliveryMode,getActivityMap,DIRECT_GATEWAY_KEYS,deliverChannelMessage} from '@/lib/channelDelivery';
import {deliverOnce,DeliveryRejectedError} from '@/lib/deliveryGuard';
import {normalizeE164} from '@/lib/csvPreflight';
import {sendEligibility} from '@/lib/sendEligibility';

async function main(){
 const args=process.argv.slice(2);const argument=(key:string)=>{const value=args[args.indexOf(key)+1];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${key}`);return value;};
 const email=args.includes('--email')?argument('--email').trim().toLowerCase():undefined;
 const phone=args.includes('--phone')?normalizeE164(argument('--phone')):undefined;
 if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Supply a valid designated test email.');
 if(args.includes('--phone')&&!phone)throw new Error('Supply an international designated test phone number.');
 const secrets:string[]=[];
 for(const [id,fields] of Object.entries(INTEGRATION_FIELDS)){const config=await getIntegrationConfig(id);for(const field of fields.filter(f=>f.secret)){const value=config[field.key]||await resolveIntegrationField(id,field.key);if(value)secrets.push(value);}}
 const sanitize=(value:string)=>secrets.filter(v=>v.length>=6).reduce((s,v)=>s.split(v).join('[REDACTED]'),value).replace(/(accessKey|secretKey|api_key|access_token)=([^&\s]+)/gi,'$1=[REDACTED]').slice(0,600);
 const results:Array<{provider:string;operation:string;status:string;detail:string}>=[];
 const check=async(provider:string,fn:()=>Promise<unknown>)=>{try{await fn();results.push({provider,operation:'connection',status:'passed',detail:'Live provider accepted the connection check.'});return true;}catch(e){results.push({provider,operation:'connection',status:'failed',detail:sanitize(e instanceof Error?e.message:String(e))});return false;}};
 const actionCheck=async(id:string)=>{const result=await testIntegrationAction(id);if(!result.ok)throw new Error(result.detail);};
 const [lsqOK,netcoreOK]=await Promise.all([
  check('leadsquared',()=>getLeadsMetadata()),check('netcore',()=>actionCheck('netcore')),
  check('zoom',()=>zoomRequest('/users/me')),check('apollo',()=>actionCheck('apollo')),check('claude',()=>actionCheck('claude')),
 ]);
 const linkedin=await getIntegrationConfig('linkedin');results.push({provider:'linkedin',operation:'connection',status:linkedin.accessToken?'configured':'not_configured',detail:'LinkedIn outreach is manual; no automated LinkedIn messages are sent.'});
 const message='Webinar Studio verification: this is the live delivery test you requested. No campaign audience was contacted.';
 const send=async(provider:string,fn:()=>Promise<unknown>)=>{try{const result=await deliverOnce('operator-verification-20261008-'+(email||phone),provider,fn,{payload:{designatedRecipient:provider==='sms'||provider==='whatsapp'?phone:email}});results.push({provider,operation:'designated_recipient_test',status:typeof result.value==='object' && result.value && 'strategyUsed' in result.value && result.value.strategyUsed==='trigger'?'crm_queued':'accepted',detail:sanitize(JSON.stringify(result.value??{}))});}catch(e){results.push({provider,operation:'designated_recipient_test',status:'failed_or_unknown',detail:sanitize(e instanceof Error?e.message:String(e))});}};
 if(email){
  const suppressed=await isEmailSuppressed(email);if(suppressed)throw new Error('Designated test email is suppressed; the test will not bypass suppression.');
  const contacts=await db.contact.findMany({where:{email:{equals:email,mode:'insensitive'}}});for(const c of contacts){const eligible=await sendEligibility(c.campaignId,c,'email');if(!eligible.ok)throw new Error(eligible.reason);}
  if(lsqOK)await send('leadsquared',async()=>{await createOrUpdateLead([{Attribute:'EmailAddress',Value:email}]);return sendEmailToLead({recipientEmail:email,subject:'[TEST] Webinar Studio delivery verification',contentHtml:`<p>${message}</p>`,contentText:message});});
  else results.push({provider:'leadsquared',operation:'designated_recipient_test',status:'blocked',detail:'Live connection rejected; no email send attempted.'});
  if(netcoreOK)await send('netcore',async()=>{const result=await sendNetcoreEmail({to:email,subject:'[TEST] Webinar Studio delivery verification',html:`<p>${message}</p>`,text:message,tags:['operator_verification']});if(!result.ok)throw new DeliveryRejectedError(result.error||'Netcore rejected the test.');return {messageId:result.messageId};});
  else results.push({provider:'netcore',operation:'designated_recipient_test',status:'blocked',detail:'Live connection rejected; no email send attempted.'});
 }
 if(phone){
  const lead=lsqOK&&email?await getLeadByEmailAddress(email):null;
  const phoneMatches=lead&&[lead.Phone,lead.Mobile].some(v=>normalizeE164(v||'')===phone);
  const digits=phone.replace(/\D/g,'');const known=await db.$queryRaw<Array<{campaignId:string;email:string|null;phone:string|null;unsubscribedAt:Date|null;smsOptOut:boolean;whatsappOptIn:boolean}>>`SELECT * FROM "Contact" WHERE regexp_replace(coalesce(phone,''),'[^0-9]','','g')=${digits}`;const mapping=await getActivityMap();
  for(const channel of ['sms','whatsapp'] as const){
   const mode=await getChannelDeliveryMode(channel);const endpoint=await db.appSetting.findUnique({where:{key:DIRECT_GATEWAY_KEYS[channel].endpoint}});
   const trigger=await db.appSetting.findUnique({where:{key:'lsq_channel_trigger_activity_type_id'}});
   if(mode==='direct'&&!endpoint?.value || mode==='trigger'&&(!lsqOK||!phoneMatches||!lead?.ProspectID||!mapping[channel]?.typeId&&!trigger?.value)){
    results.push({provider:channel,operation:'designated_recipient_test',status:'blocked',detail:mode==='direct'?'Direct gateway endpoint is not configured.':'CRM trigger test needs a valid connection, existing activity mapping and a lead whose phone matches the designated recipient.'});continue;
   }
   let blocked=false;for(const c of known){const eligible=await sendEligibility(c.campaignId,c,channel);if(!eligible.ok){results.push({provider:channel,operation:'designated_recipient_test',status:'blocked',detail:eligible.reason});blocked=true;break;}}if(blocked)continue;
   await send(channel,()=>deliverChannelMessage({channel,stepKey:'operator_verification',campaignName:'Operator delivery verification',message,phone,lsqLeadId:phoneMatches?lead?.ProspectID||'':''}));
  }
 }
 await mkdir('artifacts/verification',{recursive:true});const report={checkedAt:new Date().toISOString(),designatedEmail:email,designatedPhone:phone,results};await writeFile('artifacts/verification/live-providers.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}).finally(()=>db.$disconnect());
