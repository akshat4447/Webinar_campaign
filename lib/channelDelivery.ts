import { decryptCredential } from '@/lib/credentialCipher';
import { assertPublicUrl, publicDispatcher } from '@/lib/safeFetch';
import { DeliveryRejectedError } from '@/lib/deliveryGuard';

import { db } from './db';
import { resolveIntegrationField } from './integrationConfig';
import {
  createActivityType,
  getActivityTypeDetails,
  listActivityTypes,
  pushCustomActivities,
  type CustomActivity,
} from './leadsquared';

export type ChannelStrategy = 'direct' | 'trigger' | 'auto';
export type DeliveryChannel = 'sms' | 'whatsapp';

const TRIGGER_TYPE_SETTING = 'lsq_channel_trigger_activity_type_id';
const ACTIVITY_MAP_SETTING = 'lsq_activity_map_setting';
/** Exported so callers can distinguish "no mapping saved" from "mapping of all-none". */
export const ACTIVITY_MAP_SETTING_KEY = ACTIVITY_MAP_SETTING;

/** Schema names for the trigger activity's custom fields — overridable via manual mapping. */
export interface TriggerFieldMap {
  channel: string;
  stepKey: string;
  message: string;
}

export const DEFAULT_TRIGGER_FIELDS: TriggerFieldMap = {
  channel: 'mx_Custom_1',
  stepKey: 'mx_Custom_2',
  message: 'mx_Custom_3',
};

export interface ChannelActivityMapping {
  /** Post THIS activity type id (discovered or manually entered). */
  typeId?: number;
}

const MAP_CHANNELS = ['email', 'linkedin', 'sms', 'whatsapp'] as const;

/** Reads the operator-configurable activity map (channel → activity type). */
export async function getActivityMap(): Promise<Record<string, ChannelActivityMapping | null>> {
  try {
    const raw = await db.appSetting.findUnique({ where: { key: ACTIVITY_MAP_SETTING } });
    if (raw?.value) {
      const parsed = JSON.parse(raw.value) as Record<string, ChannelActivityMapping | null>;
      const out: Record<string, ChannelActivityMapping | null> = {};
      for (const ch of MAP_CHANNELS) out[ch] = parsed[ch] ?? null;
      return out;
    }
  } catch {
    /* fall through to defaults */
  }
  const out: Record<string, ChannelActivityMapping | null> = {};
  for (const ch of MAP_CHANNELS) out[ch] = null;
  return out;
}

export async function saveActivityMap(map: Record<string, ChannelActivityMapping | null>): Promise<void> {
  await db.appSetting.upsert({
    where: { key: ACTIVITY_MAP_SETTING },
    create: { key: ACTIVITY_MAP_SETTING, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
}

/** Trigger field schema names: mapped overrides first, mx_Custom_N defaults second. */
export async function getTriggerFieldMap(): Promise<TriggerFieldMap> {
  try {
    const raw = await db.appSetting.findUnique({ where: { key: 'lsq_trigger_field_map' } });
    if (raw?.value) {
      const parsed = JSON.parse(raw.value) as Partial<TriggerFieldMap>;
      return {
        channel: parsed.channel || DEFAULT_TRIGGER_FIELDS.channel,
        stepKey: parsed.stepKey || DEFAULT_TRIGGER_FIELDS.stepKey,
        message: parsed.message || DEFAULT_TRIGGER_FIELDS.message,
      };
    }
  } catch {
    /* defaults below */
  }
  return DEFAULT_TRIGGER_FIELDS;
}

export async function saveTriggerFieldMap(map: TriggerFieldMap): Promise<void> {
  await db.appSetting.upsert({
    where: { key: 'lsq_trigger_field_map' },
    create: { key: 'lsq_trigger_field_map', value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
}

export const DIRECT_GATEWAY_KEYS = {
  sms: {
    endpoint: 'direct_sms_endpoint',
    authToken: 'direct_sms_auth_token',
    senderId: 'direct_sms_sender_id',
    templateId: 'direct_sms_template_id',
  },
  whatsapp: {
    endpoint: 'direct_wa_endpoint',
    authToken: 'direct_wa_auth_token',
    senderId: 'direct_wa_phone_number_id',
    templateId: 'direct_wa_template_name',
  },
} as const;

const MODE_SETTING_PREFIX = 'channel_delivery_mode_';

/** Returns strictly 'trigger' (LeadSquared Automation) or 'direct' (Direct Gateway API). */
export async function getChannelDeliveryMode(channel: DeliveryChannel): Promise<'trigger' | 'direct'> {
  try {
    const custom = await db.appSetting.findUnique({ where: { key: `${MODE_SETTING_PREFIX}${channel}` } });
    if (custom?.value === 'direct') return 'direct';
    if (custom?.value === 'trigger') return 'trigger';
  } catch {
    /* fallback to legacy */
  }

  // Backwards compatibility with legacy lsq settings
  try {
    const legacy = ((await resolveIntegrationField('lsq', channel === 'sms' ? 'smsStrategy' : 'whatsappStrategy')) || '').toLowerCase();
    if (legacy === 'direct') return 'direct';
  } catch {
    /* default below */
  }
  return 'trigger';
}

export async function setChannelDeliveryMode(channel: DeliveryChannel, mode: 'trigger' | 'direct'): Promise<void> {
  await db.appSetting.upsert({
    where: { key: `${MODE_SETTING_PREFIX}${channel}` },
    create: { key: `${MODE_SETTING_PREFIX}${channel}`, value: mode },
    update: { value: mode },
  });
  // Also keep legacy setting in sync so existing code paths stay consistent
  const legacyKey = channel === 'sms' ? 'smsStrategy' : 'whatsappStrategy';
  await db.appSetting.upsert({
    where: { key: `integration.lsq.${legacyKey}` },
    create: { key: `integration.lsq.${legacyKey}`, value: mode },
    update: { value: mode },
  });
}

const validatedTriggerTypes=new Map<string,number>();
async function triggerTypeValid(typeId:number,fields:TriggerFieldMap=DEFAULT_TRIGGER_FIELDS):Promise<boolean>{
  if(!Number.isSafeInteger(typeId)||typeId<=0)return false;
  const [host,accessKey]=await Promise.all([resolveIntegrationField('lsq','host'),resolveIntegrationField('lsq','accessKey')]);
  const cacheKey=JSON.stringify([host,accessKey,typeId,fields]);
  if((validatedTriggerTypes.get(cacheKey)||0)>Date.now())return true;
  const details=await getActivityTypeDetails(typeId);
  if(!details || !Object.values(fields).every(schema=>details.fields.some(field=>field.schemaName===schema)))return false;
  validatedTriggerTypes.set(cacheKey,Date.now()+5*60_000);return true;
}
/** Reuse a verified existing trigger; stale cached IDs are never delivery proof. */
export async function ensureTriggerActivityTypeId():Promise<number>{
  const fields=await getTriggerFieldMap();
  const cached=await db.appSetting.findUnique({where:{key:TRIGGER_TYPE_SETTING}});
  if(cached?.value && await triggerTypeValid(Number(cached.value),fields))return Number(cached.value);
  const baseName='WebinarAgent Channel Trigger';
  const existing=await listActivityTypes();
  for(const type of existing.types.filter(t=>t.name===baseName||t.name.startsWith(baseName+' ')).sort((a,b)=>b.id-a.id)){
    if(await triggerTypeValid(type.id,fields)){await db.appSetting.upsert({where:{key:TRIGGER_TYPE_SETTING},create:{key:TRIGGER_TYPE_SETTING,value:String(type.id)},update:{value:String(type.id)}});return type.id;}
  }
  const schema=[{schemaName:fields.channel,displayName:'Channel'},{schemaName:fields.stepKey,displayName:'Cadence Step'},{schemaName:fields.message,displayName:'Message'}];
  for(let attempt=0;attempt<6;attempt++){
    try{const id=await createActivityType(attempt?`${baseName} ${attempt+1}`:baseName,schema);if(!await triggerTypeValid(id,fields))throw new Error('Created trigger does not have the required channel, step and message fields.');await db.appSetting.upsert({where:{key:TRIGGER_TYPE_SETTING},create:{key:TRIGGER_TYPE_SETTING,value:String(id)},update:{value:String(id)}});return id;}catch(error){if(!/already exists/i.test(String(error))||attempt===5)throw error;}
  }
  throw new Error('Could not configure a valid channel trigger.');
}

export interface ChannelDeliveryInput {
  channel: DeliveryChannel;
  stepKey: string;
  campaignName: string;
  message: string;

  phone: string;
  lsqLeadId: string;
  dltTemplateId?: string | null;
  senderId?: string | null;
}

export interface ChannelDeliveryResult {
  strategyUsed: Exclude<ChannelStrategy, 'auto'>;
  detail: string;
}

export interface DirectSendParams {
  channel: DeliveryChannel;
  endpoint: string;
  authToken?: string | null;
  senderId?: string | null;
  templateId?: string | null;
  phone: string;
  message: string;
}

export interface DirectSendResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  body: unknown;
  rawText: string;
}

/**
 * Sanitizes SMS copy to standard GSM-7 characters to prevent unintentional
 * escalation to UCS-2 Unicode (which reduces segment capacity from 160 to 70 characters).
 */
export function sanitizeGsm7(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/[\u2013\u2014]/g, '-') // en/em dashes
    .replace(/\u2026/g, '...') // ellipsis
    .replace(/[\u00A0]/g, ' ') // non-breaking space
    .trim();
}

/**
 * Universal Direct Gateway HTTP Dispatcher.
 * Dispatches a POST request to the direct gateway endpoint with 10s timeout,
 * standard auth headers, and normalized JSON payload.
 */
export async function executeDirectSend(params: DirectSendParams): Promise<DirectSendResult> {
  const { channel, endpoint, authToken, senderId, templateId, phone, message } = params;
  if (!endpoint || !endpoint.startsWith('http')) {
    throw new Error(`Direct ${channel.toUpperCase()} endpoint must be a valid HTTP/HTTPS URL (got: "${endpoint || 'empty'}").`);
  }

  const started = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'WebinarCampaignAgent/1.0',
  };

  if (authToken?.trim()) {
    const token = authToken.trim();
    if (token.toLowerCase().startsWith('bearer ') || token.toLowerCase().startsWith('basic ')) {
      headers['Authorization'] = token;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  // Build normalized payload
  let payload: Record<string, unknown>;
  if (channel === 'sms') {
    const cleanSms = sanitizeGsm7(message);
    payload = {
      to: phone,
      destination: phone,
      message: cleanSms,
      text: cleanSms,
      ...(senderId ? { senderId, from: senderId } : {}),
      ...(templateId ? { dltTemplateId: templateId, templateId } : {}),
    };
  } else {
    payload = {
      to: phone,
      destination: phone,
      message,
      text: message,
      ...(senderId ? { from: senderId, phoneNumberId: senderId } : {}),
      ...(templateId ? { templateName: templateId, templateId } : {}),
    };
  }

  await assertPublicUrl(endpoint);
  const dispatcher = process.env.ALLOW_PRIVATE_FETCH === '1' ? undefined : publicDispatcher();
  try {
  const res = await fetch(endpoint, {
    dispatcher,
    redirect: 'error',
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  } as RequestInit & { dispatcher?: ReturnType<typeof publicDispatcher> });

  const latencyMs = Date.now() - started;
  const rawText = await res.text();
  let parsedBody: unknown = rawText;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* not json */
  }

  return {
    ok: res.ok,
    status: res.status,
    latencyMs,
    body: parsedBody,
    rawText,
  };
  } finally { await dispatcher?.close(); }
}

async function deliverDirect(input: ChannelDeliveryInput): Promise<string> {
  const keys = DIRECT_GATEWAY_KEYS[input.channel];
  const [endpointRaw, authTokenRaw, senderIdRaw, templateIdRaw] = await Promise.all([
    db.appSetting.findUnique({ where: { key: keys.endpoint } }),
    db.appSetting.findUnique({ where: { key: keys.authToken } }),
    db.appSetting.findUnique({ where: { key: keys.senderId } }),
    db.appSetting.findUnique({ where: { key: keys.templateId } }),
  ]);

  // Fallback to legacy fields if new direct settings are not set
  const endpoint = endpointRaw?.value || (await resolveIntegrationField('lsq', input.channel === 'sms' ? 'smsEndpoint' : 'waEndpoint')) || '';
  const authToken = authTokenRaw?.value ? decryptCredential(authTokenRaw.value) : '';
  const senderId = input.senderId || senderIdRaw?.value || '';
  const templateId = input.dltTemplateId || templateIdRaw?.value || '';

  if (!endpoint) {
    throw new Error(
      `Direct ${input.channel.toUpperCase()} endpoint is not configured. Configure it on the Integrations page or switch to LeadSquared Automation mode.`
    );
  }

  const result = await executeDirectSend({
    channel: input.channel,
    endpoint,
    authToken,
    senderId,
    templateId,
    phone: input.phone,
    message: input.message,
  });

  if (!result.ok) {
    throw new DeliveryRejectedError(`Direct ${input.channel.toUpperCase()} gateway returned HTTP ${result.status} (${result.latencyMs}ms)`, result.status);
  }

  // On successful direct dispatch, post standard activity to LeadSquared CRM for audit history
  if (input.lsqLeadId) {
    try {
      if (input.channel === 'sms') {
        // Event 200: SMS Sent
        await pushCustomActivities([
          {
            RelatedProspectId: input.lsqLeadId,
            ActivityEvent: 200,
            ActivityNote: `Direct SMS sent to ${input.phone}: ${input.message.slice(0, 150)}`,
          },
        ]);
      } else {
        // Event 174: WhatsApp Message
        await pushCustomActivities([
          {
            RelatedProspectId: input.lsqLeadId,
            ActivityEvent: 174,
            ActivityNote: `Direct WhatsApp message sent to ${input.phone}: ${input.message.slice(0, 150)}`,
          },
        ]);
      }
    } catch {
      // CRM activity logging failure must not fail the delivered send
    }
  }

  return `direct gateway accepted (HTTP ${result.status}, ${result.latencyMs}ms)`;
}

async function deliverViaTrigger(input: ChannelDeliveryInput): Promise<string> {
  const targetLeadId = input.lsqLeadId;
  if (!targetLeadId) throw new Error('LeadSquared automation requires a linked lead.');

  // Per-channel mapped type wins; otherwise the shared auto-provisioned type.
  const map = await getActivityMap();
  const override = map[input.channel]?.typeId;
  const fieldNames = await getTriggerFieldMap();
  const typeId = override ?? (await ensureTriggerActivityTypeId());
  if(override && !await triggerTypeValid(override,fieldNames))throw new DeliveryRejectedError(`Mapped ${input.channel} activity #${override} is missing the channel, step or message fields. Fix the activity mapping.`);

  const safeMessage = Array.from(input.message).slice(0, 500).join('');
  const activity: CustomActivity = {
    RelatedProspectId: targetLeadId,
    ActivityEvent: typeId,
    ActivityNote: `${input.channel.toUpperCase()} step "${input.stepKey}" due — ${input.campaignName}`,
    Fields: [
      { SchemaName: fieldNames.channel, Value: input.channel },
      { SchemaName: fieldNames.stepKey, Value: input.stepKey },
      { SchemaName: fieldNames.message, Value: safeMessage },
    ],
  };
  await pushCustomActivities([activity]);

  return `trigger activity posted${override ? ` on mapped type #${typeId}` : ''} — LSQ Automation delivers via its configured gateway`;
}

/**
 * Sends one channel message using the configured strategy (LeadSquared Automation vs Direct Gateway).
 */
export async function deliverChannelMessage(input: ChannelDeliveryInput): Promise<ChannelDeliveryResult> {
  const mode = await getChannelDeliveryMode(input.channel);

  if (mode === 'trigger') {
    const detail = await deliverViaTrigger(input);
    return { strategyUsed: 'trigger', detail };
  }

  const detail = await deliverDirect(input);
  return { strategyUsed: 'direct', detail };
}

/**
 * Posts a "message sent" activity IF the operator mapped an activity type for
 * this channel — giving THEIR LSQ automations a hook on every stage. Returns
 * false when nothing is mapped (silently, by design).
 */
export async function postSentActivityIfMapped(opts: {
  channel: 'email' | 'linkedin' | 'sms' | 'whatsapp';
  lsqLeadId: string;
  campaignName: string;
  stepKey: string;
  note: string;
}): Promise<boolean> {
  const map = await getActivityMap();
  const mapped = map[opts.channel]?.typeId;
  if (!mapped) return false;
  await pushCustomActivities([
    {
      RelatedProspectId: opts.lsqLeadId,
      ActivityEvent: mapped,
      ActivityNote: `${opts.note} — ${opts.campaignName}`.slice(0, 480),
    },
  ]);
  return true;
}
