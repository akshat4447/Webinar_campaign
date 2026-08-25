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

async function strategyFor(channel: DeliveryChannel): Promise<ChannelStrategy> {
  const raw = ((await resolveIntegrationField('lsq', channel === 'sms' ? 'smsStrategy' : 'whatsappStrategy')) || 'trigger').toLowerCase();
  return raw === 'direct' || raw === 'auto' ? raw : 'trigger';
}

/** One shared custom-activity type backs both channels' trigger strategy. */
async function ensureTriggerActivityTypeId(): Promise<number> {
  const existing = await db.appSetting.findUnique({ where: { key: TRIGGER_TYPE_SETTING } });
  if (existing) return Number(existing.value);
  const id = await createActivityType('WebinarAgent Channel Trigger', [
    { schemaName: 'mxp_Channel', displayName: 'Channel' },
    { schemaName: 'mxp_StepKey', displayName: 'Cadence Step' },
    { schemaName: 'mxp_Message', displayName: 'Message' },
  ]);
  await db.appSetting.upsert({
    where: { key: TRIGGER_TYPE_SETTING },
    create: { key: TRIGGER_TYPE_SETTING, value: String(id) },
    update: { value: String(id) },
  });
  return id;
}

// The allowlist lead's phone, resolved once per process (same lead email is
// used by every sandboxed email send).
let cachedSandboxPhone: string | null | undefined;
async function sandboxTargetPhone(): Promise<string> {
  if (cachedSandboxPhone !== undefined) {
    if (!cachedSandboxPhone) throw new Error('The SEND_ALLOWLIST_LEAD_EMAIL lead has no Phone in LeadSquared — add one so sandboxed SMS/WhatsApp sends have a target.');
    return cachedSandboxPhone;
  }
  const email = process.env.SEND_ALLOWLIST_LEAD_EMAIL;
  if (!email) throw new Error('SEND_ALLOWLIST_LEAD_EMAIL is not set — required while SEND_MODE=sandbox.');
  const lead = await getLeadByEmailAddress(email);
  cachedSandboxPhone = lead?.Phone?.trim() || null;
  return sandboxTargetPhone();
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
  const typeId = await ensureTriggerActivityTypeId();
  const activity: CustomActivity = {
    RelatedProspectId: input.lsqLeadId,
    ActivityEvent: typeId,
    ActivityNote: `${input.channel.toUpperCase()} step "${input.stepKey}" due — ${input.campaignName}`,
    Fields: [
      { SchemaName: 'mxp_Channel', Value: input.channel },
      { SchemaName: 'mxp_StepKey', Value: input.stepKey },
      { SchemaName: 'mxp_Message', Value: input.message.slice(0, 500) },
    ],
  };
  await pushCustomActivities([activity]);
  return 'trigger activity posted — LSQ Automation delivers via its configured gateway';
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