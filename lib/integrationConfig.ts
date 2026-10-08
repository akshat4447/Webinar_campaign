import { encryptCredential, decryptCredential } from '@/lib/credentialCipher';
// Server-only. Persisted integration credentials, layered on top of the
// existing .env.local values — same pattern as lib/activityPush.ts's single
// cached AppSetting row, just with one row per credential field.
//
// A saved value here always wins over its env-var equivalent, but nothing
// currently working via .env.local breaks: every read falls back to env when
// the DB has nothing for that field.

import { db } from '@/lib/db';
import { INTEGRATION_FIELDS } from '@/lib/integrationFields';

export { INTEGRATION_FIELDS };

// What each field falls back to when nothing's saved in the DB yet.
function envFallback(id: string, key: string): string | undefined {
  const map: Record<string, string | undefined> = {
    'lsq.accessKey': process.env.LSQ_ACCESS_KEY,
    'lsq.secretKey': process.env.LSQ_SECRET_KEY,
    'lsq.host': process.env.LSQ_HOST,
    'lsq.senderEmail': process.env.LSQ_SENDER_EMAIL,
    'lsq.webhookSecret': process.env.LSQ_WEBHOOK_SECRET,
    'claude.apiKey': process.env.ANTHROPIC_API_KEY,
    'apollo.apiKey': process.env.APOLLO_API_KEY,
    'zoom.accountId': process.env.ZOOM_ACCOUNT_ID,
    'zoom.redirectUri': process.env.ZOOM_REDIRECT_URI,
    'zoom.webhookSecret': process.env.ZOOM_WEBHOOK_SECRET,
    'zoom.hostEmail': process.env.ZOOM_HOST_EMAIL,
    'linkedin.redirectUri': process.env.LINKEDIN_REDIRECT_URI,
    'netcore.apiKey': process.env.NETCORE_API_KEY,
    'netcore.fromEmail': process.env.NETCORE_FROM_EMAIL,
    'netcore.fromName': process.env.NETCORE_FROM_NAME,
    'netcore.domain': process.env.NETCORE_DOMAIN,
    'netcore.webhookSecret': process.env.NETCORE_WEBHOOK_SECRET,
    // zoom.clientId/clientSecret deliberately not here — same as linkedin,
    // each OAuth call site falls back to its env var itself (see
    // lib/zoom/client.ts, app/api/auth/zoom/*), since a client credential
    // pair for a three-legged flow behaves differently from a simple key.
  };
  return map[`${id}.${key}`];
}

function settingKey(id: string, field: string) {
  return `integration.${id}.${field}`;
}

/** Raw values (DB, no env fallback) — server-only, never sent to the client. */
export async function getIntegrationConfig(id: string): Promise<Record<string, string>> {
  const fields = INTEGRATION_FIELDS[id] ?? [];
  if (fields.length === 0) return {};
  try {
    const rows = await db.appSetting.findMany({ where: { key: { in: fields.map((f) => settingKey(id, f.key)) } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = byKey.get(settingKey(id, f.key));
      if (v) out[f.key] = f.secret ? decryptCredential(v) : v;
    }
    return out;
  } catch (err) {
    // A genuine DB outage here previously looked identical to "nothing saved
    // yet" to every caller (every integration status UI, activityPush's
    // credential check) — at least surface it in the logs so an incident
    // isn't mistaken for "integration not configured".
    console.error(`[integrationConfig] getIntegrationConfig(${id}) failed:`, err);
    throw err;
  }
}

/** DB value, falling back to env — this is what a real call actually uses. */
export async function resolveIntegrationField(id: string, key: string): Promise<string | undefined> {
  const saved = await getIntegrationConfig(id);
  return saved[key] || envFallback(id, key);
}

/**
 * Safe to send to the client: whether something is currently in effect for
 * each field (DB or env), never the value itself.
 */
export async function getIntegrationConfigMasked(id: string): Promise<Record<string, { hasValue: boolean }>> {
  const fields = INTEGRATION_FIELDS[id] ?? [];
  const saved = await getIntegrationConfig(id);
  const out: Record<string, { hasValue: boolean }> = {};
  for (const f of fields) out[f.key] = { hasValue: !!(saved[f.key] || envFallback(id, f.key)) };
  return out;
}

/** Upserts non-blank fields; clears fields explicitly marked as '__CLEAR__' or empty string when submitted. */
export async function saveIntegrationConfig(id: string, fields: Record<string, string>): Promise<void> {
  const schema = INTEGRATION_FIELDS[id] ?? [];
  const currentSaved = await getIntegrationConfig(id);

  // If LeadSquared host or accessKey is being updated to a new tenant,
  // and no new senderEmail is explicitly provided, remove the old senderEmail
  // so it doesn't pollute the new tenant with an invalid user address from the old org.
  if (id === 'lsq') {
    const isNewTenant =
      Boolean(fields['accessKey'] && fields['accessKey'] !== currentSaved['accessKey']) ||
      Boolean(fields['host'] && fields['host'] !== currentSaved['host']);
    if (isNewTenant && !fields['senderEmail']) {
      await db.appSetting.deleteMany({ where: { key: settingKey('lsq', 'senderEmail') } });
    }
  }

  for (const f of schema) {
    if (!(f.key in fields)) continue;
    const value = fields[f.key];
    const key = settingKey(id, f.key);
    if (value === '__CLEAR__' || value === '') {
      await db.appSetting.deleteMany({ where: { key } });
    } else if (value && value.trim()) {
      await db.appSetting.upsert({ where: { key }, create: { key, value: f.secret ? encryptCredential(value.trim()) : value.trim() }, update: { value: f.secret ? encryptCredential(value.trim()) : value.trim() } });
    }
  }
}

export interface TestResult {
  ok: boolean;
  detail: string;
  testedAt: string;
}

/** Records the outcome of a real "Test connection" call — no credential material, just status. */
export async function saveTestResult(id: string, ok: boolean, detail: string): Promise<void> {
  const testedAt = new Date().toISOString();
  const entries: [string, string][] = [
    [settingKey(id, 'lastTestOk'), ok ? '1' : '0'],
    [settingKey(id, 'lastTestedAt'), testedAt],
    [settingKey(id, 'lastTestDetail'), detail.slice(0, 300)],
  ];
  await db.$transaction(entries.map(([key, value]) => db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })));
}

export async function getTestResult(id: string): Promise<TestResult | null> {
  const keys = ['lastTestOk', 'lastTestedAt', 'lastTestDetail'].map((k) => settingKey(id, k));
  const rows = await db.appSetting.findMany({ where: { key: { in: keys } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const ok = byKey.get(settingKey(id, 'lastTestOk'));
  if (ok === undefined) return null;
  return { ok: ok === '1', detail: byKey.get(settingKey(id, 'lastTestDetail')) ?? '', testedAt: byKey.get(settingKey(id, 'lastTestedAt')) ?? '' };
}
