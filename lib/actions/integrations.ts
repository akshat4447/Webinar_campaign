'use server';

import { requireOperatorSession } from '@/lib/operatorSession';
import { testIntegrationConnection } from '@/lib/integrationConnection';

import { encryptCredential, decryptCredential } from '@/lib/credentialCipher';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import {
  getIntegrationConfigMasked,
  saveIntegrationConfig,
  saveTestResult,
  getTestResult,
  resolveIntegrationField,
} from '@/lib/integrationConfig';

const LOG_KEYWORDS: Record<string, string[]> = {
  lsq: ['LeadSquared'],
  zoom: ['Zoom', 'attendance', 'attended', 'no-show'],
  claude: ['Claude', 'scored', 'rewrit'],
  apollo: ['Apollo'],
  linkedin: ['LinkedIn'],
};

export async function getIntegrationLogAction(integrationId: string) {
  await requireOperatorSession();
  const keywords = LOG_KEYWORDS[integrationId] ?? [integrationId];
  const entries = await db.activityLogEntry.findMany({
    where: { OR: keywords.map((k) => ({ text: { contains: k, mode: 'insensitive' as const } })) },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { campaign: { select: { name: true } } },
  });
  return entries.map((e) => ({ campaign: e.campaign.name, text: e.text, time: e.createdAt.toISOString() }));
}

export async function getIntegrationConfigMaskedAction(id: string) {
  await requireOperatorSession();
  return getIntegrationConfigMasked(id);
}

export async function getIntegrationStatusAction(id: string) {
  await requireOperatorSession();
  return getTestResult(id);
}

/** Saves only the fields the user actually typed — a blank field leaves its stored value untouched. */
/** The saved Redirect URI for Zoom (not a secret), so the page can say when it is not this server's address. */
export async function getZoomRedirectInfoAction(): Promise<{ saved: string | null }> {
  await requireOperatorSession();
  const saved = (await resolveIntegrationField('zoom', 'redirectUri')) || process.env.ZOOM_REDIRECT_URI || '';
  return { saved: saved.trim() || null };
}

export async function saveIntegrationConfigAction(id: string, fields: Record<string, string>) {
  await requireOperatorSession();
  await saveIntegrationConfig(id, fields);
  // Neither this modal nor its siblings on /integrations call router.refresh()
  // themselves after saving, matching none of this file's 19 actions —
  // unlike lib/actions/netcore.ts's equivalent writes, which all do this.
  // Without it, another card reading the same config (e.g. a connection
  // status badge) kept showing stale data until a manual reload.
  try {
    revalidatePath('/integrations');
  } catch {
    // outside request context
  }
  return { savedAt: new Date().toISOString() };
}

/**
 * Finds a sending identity this tenant accepts and (optionally) saves it.
 * Sends no email — see probeSenderIdentity() for why the probe is safe.
 */
export async function discoverSenderAction(save = true) {
  await requireOperatorSession();
  const { discoverSender } = await import('@/lib/lsqSender');
  try {
    // Who "the operator" is only nudges the ranking toward a matching name or
    // domain. Prefer whatever sender is already configured, then an explicit
    // env hint; an empty string simply means no preference.
    const operatorEmail =
      (await resolveIntegrationField('lsq', 'senderEmail')) || process.env.OPERATOR_EMAIL || '';
    const result = await discoverSender(operatorEmail);
    if (result.sender && save) {
      await saveIntegrationConfig('lsq', { senderEmail: result.sender });
      await saveTestResult('lsq', true, `Sender auto-configured: ${result.sender}`);
      revalidatePath('/integrations');
    }
    return { ok: true as const, ...result };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}



/**
 * Resolves typed → saved (DB) → env for each field this connector has, so
 * "Test connection" works whether or not anything's been saved yet — hitting
 * Test with every field blank tests whatever is already in effect (env or a
 * prior save), exactly like the real production call paths do.
 */


export async function testIntegrationAction(id: string, typedFields: Record<string, string> = {}): Promise<{ ok: boolean; detail: string; autoDiscovered?: { domain: string; fromEmail: string; fromName: string } }> {
  await requireOperatorSession();
  return testIntegrationConnection(id, typedFields);
}

// --- activity mapping (channel → LSQ activity type) ----------------------------

export async function listLsqActivityTypesAction() {
  await requireOperatorSession();
  const { listActivityTypes } = await import('@/lib/leadsquared');
  try {
    const { types, sourcePath, attempts } = await listActivityTypes();
    // Zero types is a failure, not a quiet success — reporting it as ok:true
    // is what made the mapping card look loaded while showing nothing.
    if (types.length === 0) {
      return {
        ok: false as const,
        error: `LeadSquared returned no activity types. Tried: ${attempts.join(' | ').slice(0, 400) || 'no candidate paths ran'}`,
      };
    }
    return { ok: true as const, types, sourcePath };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

export async function getActivityMappingAction(): Promise<{
  map: Record<string, { typeId?: number } | null>;
  triggerFields: { channel: string; stepKey: string; message: string };
  /** False until a mapping has actually been persisted, so the UI can say so
   *  rather than showing an all-"none" form that looks the same as a broken one. */
  everSaved: boolean;
}> {
  await requireOperatorSession();
  const { getActivityMap, getTriggerFieldMap, ACTIVITY_MAP_SETTING_KEY } = await import('@/lib/channelDelivery');
  const [map, triggerFields, row] = await Promise.all([
    getActivityMap(),
    getTriggerFieldMap(),
    db.appSetting.findUnique({ where: { key: ACTIVITY_MAP_SETTING_KEY }, select: { key: true } }),
  ]);
  return { map, triggerFields, everSaved: !!row };
}

export async function saveLsqActivityMappingAction(
  map: Record<string, { typeId?: number } | null>,
  triggerFields: { channel: string; stepKey: string; message: string }
) {
  await requireOperatorSession();
  const { saveActivityMap, saveTriggerFieldMap } = await import('@/lib/channelDelivery');
  await saveActivityMap(map);
  await saveTriggerFieldMap(triggerFields);
  revalidatePath('/integrations');
  return { savedAt: new Date().toISOString() };
}

// --- channel delivery settings (LSQ Automation vs Direct Gateway) --------------

export interface DirectChannelSettings {
  mode: 'trigger' | 'direct';
  endpoint: string;
  hasAuthToken: boolean;
  senderId: string;
  templateId: string;
  lastTestOk: boolean | null;
  lastTestedAt: string | null;
  lastTestDetail: string | null;
}

export interface ChannelDeliverySettingsResult {
  sms: DirectChannelSettings;
  whatsapp: DirectChannelSettings;
  defaultPhone: string;
}

export async function getChannelDeliverySettingsAction(): Promise<ChannelDeliverySettingsResult> {
  await requireOperatorSession();
  const { getChannelDeliveryMode, DIRECT_GATEWAY_KEYS } = await import('@/lib/channelDelivery');

  const [smsMode, waMode] = await Promise.all([
    getChannelDeliveryMode('sms'),
    getChannelDeliveryMode('whatsapp'),
  ]);

  const keys = [
    DIRECT_GATEWAY_KEYS.sms.endpoint,
    DIRECT_GATEWAY_KEYS.sms.authToken,
    DIRECT_GATEWAY_KEYS.sms.senderId,
    DIRECT_GATEWAY_KEYS.sms.templateId,
    DIRECT_GATEWAY_KEYS.whatsapp.endpoint,
    DIRECT_GATEWAY_KEYS.whatsapp.authToken,
    DIRECT_GATEWAY_KEYS.whatsapp.senderId,
    DIRECT_GATEWAY_KEYS.whatsapp.templateId,
    'integration.direct_sms.lastTestOk',
    'integration.direct_sms.lastTestedAt',
    'integration.direct_sms.lastTestDetail',
    'integration.direct_wa.lastTestOk',
    'integration.direct_wa.lastTestedAt',
    'integration.direct_wa.lastTestDetail',
  ];

  const rows = await db.appSetting.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  // No pre-filled test number. It used to default to a hard-coded personal number, then to the newest
  // contact's phone, so one click on "Send test" could text a real prospect. The operator types the number.
  const defaultPhone = '';

  return {
    sms: {
      mode: smsMode,
      endpoint: map.get(DIRECT_GATEWAY_KEYS.sms.endpoint) || '',
      hasAuthToken: !!map.get(DIRECT_GATEWAY_KEYS.sms.authToken),
      senderId: map.get(DIRECT_GATEWAY_KEYS.sms.senderId) || '',
      templateId: map.get(DIRECT_GATEWAY_KEYS.sms.templateId) || '',
      lastTestOk: map.has('integration.direct_sms.lastTestOk') ? map.get('integration.direct_sms.lastTestOk') === '1' : null,
      lastTestedAt: map.get('integration.direct_sms.lastTestedAt') || null,
      lastTestDetail: map.get('integration.direct_sms.lastTestDetail') || null,
    },
    whatsapp: {
      mode: waMode,
      endpoint: map.get(DIRECT_GATEWAY_KEYS.whatsapp.endpoint) || '',
      hasAuthToken: !!map.get(DIRECT_GATEWAY_KEYS.whatsapp.authToken),
      senderId: map.get(DIRECT_GATEWAY_KEYS.whatsapp.senderId) || '',
      templateId: map.get(DIRECT_GATEWAY_KEYS.whatsapp.templateId) || '',
      lastTestOk: map.has('integration.direct_wa.lastTestOk') ? map.get('integration.direct_wa.lastTestOk') === '1' : null,
      lastTestedAt: map.get('integration.direct_wa.lastTestedAt') || null,
      lastTestDetail: map.get('integration.direct_wa.lastTestDetail') || null,
    },
    defaultPhone,
  };
}

export async function saveChannelDeliveryModeAction(channel: 'sms' | 'whatsapp', mode: 'trigger' | 'direct') {
  await requireOperatorSession();
  const { setChannelDeliveryMode } = await import('@/lib/channelDelivery');
  await setChannelDeliveryMode(channel, mode);
  revalidatePath('/integrations');
  return { ok: true, mode };
}

export async function saveDirectGatewayConfigAction(
  channel: 'sms' | 'whatsapp',
  config: { endpoint?: string; authToken?: string; senderId?: string; templateId?: string }
) {
  await requireOperatorSession();
  const { DIRECT_GATEWAY_KEYS } = await import('@/lib/channelDelivery');
  const keys = DIRECT_GATEWAY_KEYS[channel];

  const ops: Promise<unknown>[] = [];
  if (config.endpoint !== undefined) {
    ops.push(
      db.appSetting.upsert({
        where: { key: keys.endpoint },
        create: { key: keys.endpoint, value: config.endpoint.trim() },
        update: { value: config.endpoint.trim() },
      })
    );
  }
  if (config.authToken !== undefined && config.authToken.trim()) {
    ops.push(
      db.appSetting.upsert({
        where: { key: keys.authToken },
        create: { key: keys.authToken, value: encryptCredential(config.authToken.trim()) },
        update: { value: encryptCredential(config.authToken.trim()) },
      })
    );
  }
  if (config.senderId !== undefined) {
    ops.push(
      db.appSetting.upsert({
        where: { key: keys.senderId },
        create: { key: keys.senderId, value: config.senderId.trim() },
        update: { value: config.senderId.trim() },
      })
    );
  }
  if (config.templateId !== undefined) {
    ops.push(
      db.appSetting.upsert({
        where: { key: keys.templateId },
        create: { key: keys.templateId, value: config.templateId.trim() },
        update: { value: config.templateId.trim() },
      })
    );
  }

  await Promise.all(ops);
  revalidatePath('/integrations');
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function testDirectChannelAction(params: {
  channel: 'sms' | 'whatsapp';
  targetPhone: string;
  endpoint?: string;
  authToken?: string;
  senderId?: string;
  templateId?: string;
}): Promise<{ ok: boolean; status: number; latencyMs: number; detail: string; rawResponse?: string }> {
  await requireOperatorSession();
  const { channel, targetPhone } = params;
  const { DIRECT_GATEWAY_KEYS, executeDirectSend } = await import('@/lib/channelDelivery');
  const keys = DIRECT_GATEWAY_KEYS[channel];

  // Resolve typed values or stored DB values
  const [dbEndpoint, dbAuthToken, dbSenderId, dbTemplateId] = await Promise.all([
    db.appSetting.findUnique({ where: { key: keys.endpoint } }),
    db.appSetting.findUnique({ where: { key: keys.authToken } }),
    db.appSetting.findUnique({ where: { key: keys.senderId } }),
    db.appSetting.findUnique({ where: { key: keys.templateId } }),
  ]);

  const endpoint = params.endpoint?.trim() || dbEndpoint?.value || '';
  const authToken = params.authToken?.trim() || (dbAuthToken?.value ? decryptCredential(dbAuthToken.value) : '');
  const senderId = params.senderId?.trim() || dbSenderId?.value || '';
  const templateId = params.templateId?.trim() || dbTemplateId?.value || '';

  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      detail: `Direct ${channel.toUpperCase()} Endpoint URL is required.`,
    };
  }

  const cleanPhone = targetPhone.replace(/[^\d+]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      detail: 'Please provide a valid mobile number with country code (e.g. +911234567890).',
    };
  }

  const testMessage = `Test message from Webinar Campaign Agent (${channel.toUpperCase()}) at ${new Date().toLocaleTimeString()}`;

  try {
    const result = await executeDirectSend({
      channel,
      endpoint,
      authToken,
      senderId,
      templateId,
      phone: cleanPhone,
      message: testMessage,
    });

    const detail = result.ok
      ? `HTTP ${result.status} (${result.latencyMs}ms) · Gateway accepted test message: ${result.rawText.slice(0, 150) || 'OK'}`
      : `HTTP ${result.status} (${result.latencyMs}ms) · Gateway error: ${result.rawText.slice(0, 200) || 'Failed'}`;

    // Persist diagnostic result
    const prefix = channel === 'sms' ? 'integration.direct_sms' : 'integration.direct_wa';
    await Promise.all([
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestOk` }, create: { key: `${prefix}.lastTestOk`, value: result.ok ? '1' : '0' }, update: { value: result.ok ? '1' : '0' } }),
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestedAt` }, create: { key: `${prefix}.lastTestedAt`, value: new Date().toISOString() }, update: { value: new Date().toISOString() } }),
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestDetail` }, create: { key: `${prefix}.lastTestDetail`, value: detail }, update: { value: detail } }),
    ]);

    return {
      ok: result.ok,
      status: result.status,
      latencyMs: result.latencyMs,
      detail,
      rawResponse: result.rawText,
    };
  } catch (err) {
    const errorMsg = String(err instanceof Error ? err.message : err);
    const detail = `Request failed: ${errorMsg.slice(0, 200)}`;
    const prefix = channel === 'sms' ? 'integration.direct_sms' : 'integration.direct_wa';
    await Promise.all([
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestOk` }, create: { key: `${prefix}.lastTestOk`, value: '0' }, update: { value: '0' } }),
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestedAt` }, create: { key: `${prefix}.lastTestedAt`, value: new Date().toISOString() }, update: { value: new Date().toISOString() } }),
      db.appSetting.upsert({ where: { key: `${prefix}.lastTestDetail` }, create: { key: `${prefix}.lastTestDetail`, value: detail }, update: { value: detail } }),
    ]);

    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      detail,
    };
  }
}
