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
    'claude.apiKey': process.env.ANTHROPIC_API_KEY,
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
  const rows = await db.appSetting.findMany({ where: { key: { in: fields.map((f) => settingKey(id, f.key)) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = byKey.get(settingKey(id, f.key));
    if (v) out[f.key] = v;
  }
  return out;
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

/** Upserts only the non-blank fields — a blank field means "leave unchanged". */
export async function saveIntegrationConfig(id: string, fields: Record<string, string>): Promise<void> {
  const schema = INTEGRATION_FIELDS[id] ?? [];
  for (const f of schema) {
    const value = fields[f.key];
    if (!value) continue;
    const key = settingKey(id, f.key);
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
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
