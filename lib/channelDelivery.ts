// Channel delivery for the SMS / WhatsApp cadence steps — BOTH strategies,
// selectable per channel on the Integrations page:
//
//   trigger (default)  push a custom activity on the lead; a one-time LSQ
//                      Automation program sends through LeadSquared's own
//                      gateway, inheriting DND scrubbing, sender IDs and
//                      Meta-approved WhatsApp templates.
//   direct             call a per-lead send endpoint directly. The path is
//                      tenant-specific config (lsq.smsEndpoint / lsq.waEndpoint)
//                      because LSQ exposes these differently per account.
//   auto               try direct first; on any failure fall back to trigger.
//
// Compliance lives here too: WhatsApp requires an explicit opt-in flag on the
// contact, SMS respects the opt-out flag, and SEND_MODE=sandbox redirects every
// send to the allowlist lead's phone — exactly how email sandboxing works.

import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import {
  createActivityType,
  getLeadByEmailAddress,
  pushCustomActivities,
  sendSmsToLeadDirect,
  sendWhatsappDirect,
  UnsupportedChannelError,
  type CustomActivity,
} from '@/lib/leadsquared';

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

async function strategyFor(channel: DeliveryChannel): Promise<ChannelStrategy> {
  const raw = ((await resolveIntegrationField('lsq', channel === 'sms' ? 'smsStrategy' : 'whatsappStrategy')) || 'trigger').toLowerCase();
  return raw === 'direct' || raw === 'auto' ? raw : 'trigger';
}

/** One shared custom-activity type backs both channels' trigger strategy. */
export async function ensureTriggerActivityTypeId(): Promise<number> {
  // If a previous attempt left an orphan behind ("already exists"), retry under
  // a numbered name — the next create carries the CORRECT mx_Custom_N fields,
  // unlike whatever half-created row triggered the collision.
  const baseName = 'WebinarAgent Channel Trigger';
  const fields = [
    { schemaName: 'mx_Custom_1', displayName: 'Channel' },
    { schemaName: 'mx_Custom_2', displayName: 'Cadence Step' },
    { schemaName: 'mx_Custom_3', displayName: 'Message' },
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const name = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`;
    try {
      const id = await createActivityType(name, fields);
      await db.appSetting.upsert({
        where: { key: TRIGGER_TYPE_SETTING },
        create: { key: TRIGGER_TYPE_SETTING, value: String(id) },
        update: { value: String(id) },
      });
      return id;
    } catch (err) {
      lastErr = err;
      if (!/already exists/i.test(String(err))) throw err;
    }
  }
  throw lastErr ?? new Error('Could not create the trigger activity type.');
}

// The allowlist lead's phone (the same lead email receives every sandboxed
// send), cached to avoid an LSQ round trip per message.
//
// ONLY a successful lookup is cached. Caching the miss — which this used to do
// for the life of the process — made the error message a lie: it tells you to
// add a Phone in LeadSquared, but every later send re-threw from cache without
// re-reading, so the fix appeared not to work until the server was restarted.
// A config problem the operator is actively fixing has to be re-checked.
let cachedSandboxPhone: string | null = null;
async function sandboxTargetPhone(): Promise<string> {
  if (cachedSandboxPhone) return cachedSandboxPhone;

  const email = process.env.SEND_ALLOWLIST_LEAD_EMAIL;
  if (!email) throw new Error('SEND_ALLOWLIST_LEAD_EMAIL is not set — required while SEND_MODE=sandbox.');

  const lead = await getLeadByEmailAddress(email);
  // LSQ exposes both; either is a usable SMS/WhatsApp target.
  const phone = lead?.Phone?.trim() || lead?.Mobile?.trim() || '';
  if (!phone) {
    throw new Error(
      `The allowlist lead (${email}) has no Phone or Mobile in LeadSquared — add one so sandboxed SMS/WhatsApp sends have a target. It is re-checked on the next send; no restart needed.`
    );
  }
  cachedSandboxPhone = phone;
  return phone;
}

export interface ChannelDeliveryInput {
  channel: DeliveryChannel;
  stepKey: string;
  campaignName: string;
  message: string;
  /** Already transport-resolved: caller applies sandbox redirection. */
  phone: string;
  lsqLeadId: string;
}

export interface ChannelDeliveryResult {
  strategyUsed: Exclude<ChannelStrategy, 'auto'>;
  detail: string;
}

async function deliverDirect(input: ChannelDeliveryInput): Promise<string> {
  const payload = { mobile: input.phone, message: input.message };
  const res = input.channel === 'sms' ? await sendSmsToLeadDirect(payload) : await sendWhatsappDirect(payload);
  return `direct send accepted (${typeof res === 'object' && res !== null ? 'receipt returned' : 'ok'})`;
}

async function deliverViaTrigger(input: ChannelDeliveryInput): Promise<string> {
  // Per-channel mapped type wins; otherwise the shared auto-provisioned type.
  const map = await getActivityMap();
  const override = map[input.channel]?.typeId;
  const fieldNames = await getTriggerFieldMap();
  const typeId = override ?? (await ensureTriggerActivityTypeId());

  const activity: CustomActivity = {
    RelatedProspectId: input.lsqLeadId,
    ActivityEvent: typeId,
    ActivityNote: `${input.channel.toUpperCase()} step "${input.stepKey}" due — ${input.campaignName}`,
    Fields: [
      { SchemaName: fieldNames.channel, Value: input.channel },
      { SchemaName: fieldNames.stepKey, Value: input.stepKey },
      { SchemaName: fieldNames.message, Value: input.message.slice(0, 500) },
    ],
  };
  try {
    await pushCustomActivities([activity]);
  } catch (err) {
    // If the type exists WITHOUT its custom fields (possible when a previous
    // create attempt half-succeeded), fire the bare activity anyway — the
    // automation trigger only needs the activity type to appear.
    if (/custom|field/i.test(String(err))) {
      await pushCustomActivities([{ ...activity, Fields: undefined }]);
    } else {
      throw err;
    }
  }
  return `trigger activity posted${override ? ` on mapped type #${typeId}` : ''} — LSQ Automation delivers via its configured gateway`;
}

/**
 * Sends one channel message using the configured strategy, with automatic
 * fallback to the trigger path when direct isn't supported/configured or fails.
 */
export async function deliverChannelMessage(input: ChannelDeliveryInput): Promise<ChannelDeliveryResult> {
  const strategy = await strategyFor(input.channel);

  if (strategy === 'trigger') {
    const detail = await deliverViaTrigger(input);
    return { strategyUsed: 'trigger', detail };
  }

  try {
    const detail = await deliverDirect(input);
    return { strategyUsed: 'direct', detail };
  } catch (err) {
    // Explicit 'direct' surfaces real gateway errors; 'auto' falls back quietly.
    // A missing endpoint config always falls back — it's a setup gap, not an outage.
    if (strategy === 'direct' && !(err instanceof UnsupportedChannelError)) throw err;
    const detail = await deliverViaTrigger(input);
    const reason = String(err instanceof Error ? err.message : err).slice(0, 90);
    return { strategyUsed: 'trigger', detail: `${detail} (direct unavailable: ${reason})` };
  }
}

export { sandboxTargetPhone };

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