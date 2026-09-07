'use server';

import { getLeadsMetadata } from '@/lib/leadsquared';
import { db } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import {
  getIntegrationConfigMasked,
  saveIntegrationConfig,
  saveTestResult,
  getTestResult,
  resolveIntegrationField,
} from '@/lib/integrationConfig';
import { INTEGRATION_FIELDS } from '@/lib/integrationFields';

const LOG_KEYWORDS: Record<string, string[]> = {
  lsq: ['LeadSquared'],
  zoom: ['Zoom', 'attendance', 'attended', 'no-show'],
  claude: ['Claude', 'scored', 'rewrit'],
  apollo: ['Apollo'],
  apify: ['Apify'],
  linkedin: ['LinkedIn'],
};

export async function getIntegrationLogAction(integrationId: string) {
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
  return getIntegrationConfigMasked(id);
}

export async function getIntegrationStatusAction(id: string) {
  return getTestResult(id);
}

/** Saves only the fields the user actually typed — a blank field leaves its stored value untouched. */
export async function saveIntegrationConfigAction(id: string, fields: Record<string, string>) {
  await saveIntegrationConfig(id, fields);
  return { savedAt: new Date().toISOString() };
}

export async function getSendModeAction(): Promise<'sandbox' | 'live'> {
  const { getSendMode } = await import('@/lib/sendGuard');
  return getSendMode();
}

export async function setSendModeAction(mode: 'sandbox' | 'live'): Promise<{ ok: boolean; mode: 'sandbox' | 'live' }> {
  const { saveSendMode } = await import('@/lib/sendGuard');
  await saveSendMode(mode);
  return { ok: true, mode };
}

/**
 * Finds a sending identity this tenant accepts and (optionally) saves it.
 * Sends no email — see probeSenderIdentity() for why the probe is safe.
 */
export async function discoverSenderAction(save = true) {
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
    }
    return { ok: true as const, ...result };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

const TESTABLE = ['lsq', 'claude', 'apollo', 'apify', 'zoom', 'linkedin'];

/**
 * Resolves typed → saved (DB) → env for each field this connector has, so
 * "Test connection" works whether or not anything's been saved yet — hitting
 * Test with every field blank tests whatever is already in effect (env or a
 * prior save), exactly like the real production call paths do.
 */
async function resolveTestFields(id: string, typed: Record<string, string>): Promise<Record<string, string>> {
  const schema = INTEGRATION_FIELDS[id] ?? [];
  const out: Record<string, string> = {};
  for (const f of schema) {
    const v = typed[f.key] || (await resolveIntegrationField(id, f.key));
    if (v) out[f.key] = v;
  }
  return out;
}

export async function testIntegrationAction(id: string, typedFields: Record<string, string> = {}): Promise<{ ok: boolean; detail: string }> {
  const started = Date.now();
  let result: { ok: boolean; detail: string };
  try {
    if (id === 'lsq') {
      const f = await resolveTestFields('lsq', typedFields);
      if (!f.accessKey || !f.secretKey || !f.host) throw new Error('Access Key, Secret Key, and Host are all required.');
      const fields = await getLeadsMetadata({ accessKey: f.accessKey, secretKey: f.secretKey, host: f.host });

      // Sender self-verify: round-trip SendEmailToLead to the configured sender
      // itself. This is THE definitive test for the "Invalid Sender details"
      // rejection that silently killed campaign emails before.
      let senderNote = '';
      // Runs in sandbox too: the recipient is the sender's own address, so it
      // reaches nobody else — and skipping it meant the one diagnostic built
      // for this problem never ran for anyone on the default SEND_MODE.
      if (f.senderEmail) {
        // The saved host may be a bare host OR a full URL; lsqFetch normalizes
        // it and so must this, or the URL becomes https://https://… and every
        // verification "fails" with a misleading fetch error.
        const senderHost = f.host.includes('://') ? new URL(f.host).host : f.host.replace(/\/.*$/, '');
        let raw = '';
        try {
          const r = await fetch(`https://${senderHost}/v2/EmailMarketing.svc/SendEmailToLead?accessKey=${encodeURIComponent(f.accessKey)}&secretKey=${encodeURIComponent(f.secretKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              SenderType: 'UserEmailAddress',
              Sender: f.senderEmail,
              RecipientType: 'LeadEmailAddress',
              Recipient: f.senderEmail,
              // LeadSquared accepts only Template|Html here — 'Text' is
              // rejected outright, so this check could never have passed.
              EmailType: 'Html',
              Subject: 'Webinar Agent — sender verification',
              ContentHTML: '<p>If you received this, the From identity works.</p>',
              ContentText: 'If you received this, the From identity works.',
              IncludeEmailFooter: true,
            }),
            cache: 'no-store',
          });
          raw = (await r.text()).slice(0, 200);
          if (!r.ok || /"Status"\s*:\s*"Error"/i.test(raw)) throw new Error(`${r.status} ${raw}`);
          senderNote = ` · sender "${f.senderEmail}" VERIFIED`;
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e);
          // Distinguish "identity rejected" from "identity fine, delivery blocked" —
          // conflating them sent everyone hunting the wrong problem.
          if (/MailDelivery/i.test(msg)) {
            senderNote = ` · sender "${f.senderEmail}" accepted, but DELIVERY is blocked account-side (check email credits, verified sending domain, DKIM/SPF)`;
          } else {
            throw new Error(
              `Sender email "${f.senderEmail}" FAILED verification: ${msg.slice(0, 160)} — use the exact email of an ACTIVE user (LSQ → Settings → Users), or clear the field.`
            );
          }
        }
      }
      result = { ok: true, detail: `200 · ${fields.length} lead fields${senderNote} · ${Date.now() - started}ms` };
    } else if (id === 'claude') {
      const f = await resolveTestFields('claude', typedFields);
      if (!f.apiKey) throw new Error('An API key is required.');
      const client = new Anthropic({ apiKey: f.apiKey });
      // Same model resolution as lib/claude.ts's real usage — otherwise an
      // ANTHROPIC_MODEL override could pass Test here while every real
      // scoring/personalization call uses a different (possibly broken) one.
      const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
      const res = await client.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with just: ok' }] });
      const text = res.content.find((b) => b.type === 'text');
      result = { ok: true, detail: `200 · model responded "${text && 'text' in text ? text.text.trim() : ''}" · ${Date.now() - started}ms` };
    } else if (id === 'apollo') {
      const f = await resolveTestFields('apollo', typedFields);
      if (!f.apiKey) throw new Error('An API key is required.');
      const res = await fetch('https://api.apollo.io/api/v1/auth/health', {
        headers: { 'x-api-key': f.apiKey, 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const body: { healthy?: boolean; is_logged_in?: boolean; error?: string; message?: string } = await res.json().catch(() => ({}));
      // Apollo's own docs: "If both values in the response are true, you are
      // ready to use the API" — `healthy` alone stays true even for a bad key
      // (it's a basic reachability flag), so checking only that would report
      // an invalid key as a successful connection.
      if (!res.ok || !body.healthy || !body.is_logged_in) {
        throw new Error(`${res.status} · ${body.message || body.error || `Apollo rejected this key (healthy: ${body.healthy}, logged in: ${body.is_logged_in}).`}`);
      }
      result = { ok: true, detail: `200 · healthy · logged in · ${Date.now() - started}ms` };
    } else if (id === 'apify') {
      const f = await resolveTestFields('apify', typedFields);
      if (!f.apiToken) throw new Error('An API token is required.');
      const res = await fetch('https://api.apify.com/v2/users/me', {
        headers: { Authorization: `Bearer ${f.apiToken}` },
        cache: 'no-store',
      });
      const body: { data?: { username?: string }; error?: { message?: string } } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} · ${body.error?.message || 'Apify rejected this token.'}`);
      result = { ok: true, detail: `200 · user "${body.data?.username ?? 'unknown'}" · ${Date.now() - started}ms` };
    } else if (id === 'zoom') {
      const f = await resolveTestFields('zoom', typedFields);
      const { getZoomMode } = await import('@/lib/zoom/client');
      if ((await getZoomMode()) !== 'live') {
        result = { ok: true, detail: `sandbox mode — meetings and participants are simulated until ZOOM_MODE=live${f.clientId ? ' · app credentials saved' : ''}` };
      } else {
        if (!f.accessToken) throw new Error('Live mode needs a connected account — click "Connect with Zoom" first.');
        const res = await fetch('https://api.zoom.us/v2/users/me', {
          headers: { Authorization: `Bearer ${f.accessToken}` },
          cache: 'no-store',
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} · ${text.slice(0, 180)}`);
        result = { ok: true, detail: `200 · token valid · ${Date.now() - started}ms` };
      }
    } else if (id === 'linkedin') {
      const f = await resolveTestFields('linkedin', typedFields);
      const { getLinkedinMode } = await import('@/lib/linkedin/client');
      const mode = await getLinkedinMode();
      if (mode !== 'live') {
        result = { ok: true, detail: `sandbox mode — every LinkedIn call is simulated until LINKEDIN_MODE=live${f.clientId ? ' · app credentials saved' : ''}` };
      } else {
        if (!f.accessToken) throw new Error('Live mode needs an access token — click “Connect with LinkedIn” first.');
        const res = await fetch('https://api.linkedin.com/rest/organizationAcls?q=member&state=APPROVED&count=1', {
          headers: {
            Authorization: `Bearer ${f.accessToken}`,
            'LinkedIn-Version': process.env.LINKEDIN_VERSION || '202608',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          cache: 'no-store',
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} · ${text.slice(0, 180)}`);
        result = { ok: true, detail: `200 · token valid · ${Date.now() - started}ms` };
      }
    } else {
      result = { ok: false, detail: 'This integration stays in demo mode for this build.' };
    }
  } catch (err) {
    result = { ok: false, detail: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
  if (TESTABLE.includes(id)) await saveTestResult(id, result.ok, result.detail);
  return result;
}

// --- activity mapping (channel → LSQ activity type) ----------------------------

export async function listLsqActivityTypesAction() {
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
  const { saveActivityMap, saveTriggerFieldMap } = await import('@/lib/channelDelivery');
  await saveActivityMap(map);
  await saveTriggerFieldMap(triggerFields);
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

  // Find a default test phone from contacts or operator
  let defaultPhone = '+919123443870';
  try {
    const contact = await db.contact.findFirst({
      where: { phone: { not: null } },
      orderBy: { id: 'desc' },
      select: { phone: true },
    });
    if (contact?.phone) defaultPhone = contact.phone;
  } catch {
    /* fallback to default */
  }

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
  const { setChannelDeliveryMode } = await import('@/lib/channelDelivery');
  await setChannelDeliveryMode(channel, mode);
  return { ok: true, mode };
}

export async function saveDirectGatewayConfigAction(
  channel: 'sms' | 'whatsapp',
  config: { endpoint?: string; authToken?: string; senderId?: string; templateId?: string }
) {
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
        create: { key: keys.authToken, value: config.authToken.trim() },
        update: { value: config.authToken.trim() },
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
  const authToken = params.authToken?.trim() || dbAuthToken?.value || '';
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
      detail: 'Please provide a valid mobile number with country code (e.g. +919123443870).',
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
