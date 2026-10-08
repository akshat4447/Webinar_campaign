import { Prisma } from '@/lib/generated/prisma/client';

// Same precedence as resolveContactRegistrationChannel. The correlated invite
// lookup uses the campaign/contact indexes and does not materialize every send.
export const registrationChannelSql = Prisma.sql`CASE
 WHEN strpos(src,'email')>0 OR strpos(src,'netcore')>0 OR src='lsq_email' THEN 'email_campaign'
 WHEN strpos(src,'whatsapp')>0 OR src='wa' THEN 'whatsapp'
 WHEN strpos(src,'linkedin_event')>0 OR strpos(src,'event_page')>0 OR strpos(src,'linkedin_reg')>0 THEN 'linkedin_event'
 WHEN strpos(src,'linkedin')>0 OR strpos(src,'inmail')>0 THEN 'linkedin'
 WHEN strpos(src,'sms')>0 OR strpos(src,'text_message')>0 THEN 'sms'
 WHEN strpos(src,'sdr')>0 OR strpos(src,'sales')>0 OR strpos(src,'rep')>0 OR strpos(src,'phone')>0 THEN 'sdr_sales'
 WHEN strpos(src,'third_part')>0 OR strpos(src,'thirdparty')>0 OR strpos(src,'partner')>0 OR strpos(src,'affiliate')>0 OR strpos(src,'sponsor')>0 THEN 'third_parties'
 WHEN strpos(src,'website')>0 OR strpos(src,'framer')>0 OR strpos(src,'landing')>0 OR strpos(src,'site')>0 OR strpos(src,'web')>0 OR strpos(src,'direct')>0 OR strpos(src,'zoom')>0 THEN 'website'
 WHEN EXISTS(SELECT 1 FROM "CadenceSend" s WHERE s."contactId"=c.id AND s."campaignId"=c."campaignId" AND s.status='sent' AND s."stepKey"='waInvite') THEN 'whatsapp'
 WHEN EXISTS(SELECT 1 FROM "CadenceSend" s WHERE s."contactId"=c.id AND s."campaignId"=c."campaignId" AND s.status='sent' AND s."stepKey"='linkedin') THEN 'linkedin'
 WHEN EXISTS(SELECT 1 FROM "CadenceSend" s WHERE s."contactId"=c.id AND s."campaignId"=c."campaignId" AND s.status='sent' AND s."stepKey"='smsInvite') THEN 'sms'
 WHEN EXISTS(SELECT 1 FROM "CadenceSend" s WHERE s."contactId"=c.id AND s."campaignId"=c."campaignId" AND s.status='sent' AND s."stepKey"='invite') THEN 'email_campaign'
 WHEN raw='one_click' THEN 'email_campaign' ELSE 'website' END`;
export const registrationSourceSql = Prisma.sql`lower(trim(coalesce("registrationSource",''))) AS raw,regexp_replace(lower(trim(coalesce("registrationSource",''))), '[-[:space:]/]+','_','g') AS src`;
