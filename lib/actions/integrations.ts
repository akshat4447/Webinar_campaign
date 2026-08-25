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
    where: { OR: keywords.map((k) => ({ text: { contains: k } })) },
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

const TESTABLE = ['lsq', 'claude', 'apollo', 'apify', 'linkedin'];

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
      result = { ok: true, detail: `200 · ${fields.length} lead fields · ${Date.now() - started}ms` };
    } else if (id === 'claude') {
      const f = await resolveTestFields('claude', typedFields);
      if (!f.apiKey) throw new Error('An API key is required.');
      const client = new Anthropic({ apiKey: f.apiKey });
      const res = await client.messages.create({ model: 'claude-opus-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with just: ok' }] });
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
    } else if (id === 'linkedin') {
      const f = await resolveTestFields('linkedin', typedFields);
      const mode = process.env.LINKEDIN_MODE === 'live' ? 'live' : 'sandbox';
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
