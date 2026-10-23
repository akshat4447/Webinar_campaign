import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';
import { getLeadsMetadata } from '@/lib/leadsquared';
import { INTEGRATION_FIELDS } from '@/lib/integrationFields';
import { resolveIntegrationField, saveIntegrationConfig, saveTestResult } from '@/lib/integrationConfig';

const TESTABLE = ['lsq', 'claude', 'apollo', 'zoom', 'linkedin', 'netcore'];

async function resolveTestFields(id: string, typed: Record<string, string>): Promise<Record<string, string>> {
  const schema = INTEGRATION_FIELDS[id] ?? [];
  const out: Record<string, string> = {};
  for (const f of schema) {
    if (typed[f.key] === '__CLEAR__' || typed[f.key] === '') {
      out[f.key] = '';
      continue;
    }
    const v = typed[f.key] || (await resolveIntegrationField(id, f.key));
    if (v) out[f.key] = v;
  }
  return out;
}

export async function testIntegrationConnection(id: string, typedFields: Record<string, string> = {}): Promise<{ ok: boolean; detail: string; autoDiscovered?: { domain: string; fromEmail: string; fromName: string } }> {
  const started = Date.now();
  let result: { ok: boolean; detail: string; autoDiscovered?: { domain: string; fromEmail: string; fromName: string } };
  try {
    if (id === 'lsq') {
      const f = await resolveTestFields('lsq', typedFields);
      if (f.accessKey) f.accessKey = f.accessKey.replace(/\\/g, '');
      if (!f.accessKey || !f.secretKey || !f.host) throw new Error('Access Key, Secret Key, and Host are all required.');

      // When switching tenants (new host or accessKey typed), don't carry over the old tenant's sender
      const currentHost = await resolveIntegrationField('lsq', 'host');
      const currentAccessKey = await resolveIntegrationField('lsq', 'accessKey');
      const isSwitchingTenant =
        Boolean(typedFields.host && typedFields.host !== currentHost) ||
        Boolean(typedFields.accessKey && typedFields.accessKey !== currentAccessKey);
      if (isSwitchingTenant && !typedFields.senderEmail) {
        f.senderEmail = '';
      }

      const fields = await getLeadsMetadata({ accessKey: f.accessKey, secretKey: f.secretKey, host: f.host });

      // Sender self-verify: round-trip SendEmailToLead to the configured sender
      // itself. This is THE definitive test for the "Invalid Sender details"
      // rejection that silently killed campaign emails before.
      let senderNote = '';
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
        signal: AbortSignal.timeout(20_000),
          });
          raw = (await r.text()).slice(0, 200);
          if (!r.ok || /"Status"\s*:\s*"Error"/i.test(raw)) throw new Error(`${r.status} ${raw}`);
          senderNote = ` · sender "${f.senderEmail}" VERIFIED`;
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e);
          // Distinguish "identity rejected" from "identity fine, delivery blocked / recipient not lead" —
          // conflating them sent everyone hunting the wrong problem.
          if (/No lead found/i.test(msg)) {
            senderNote = ` · sender "${f.senderEmail}" VERIFIED`;
          } else if (/MailDelivery/i.test(msg)) {
            senderNote = ` · sender "${f.senderEmail}" accepted, but DELIVERY is blocked account-side (check email credits, verified sending domain, DKIM/SPF)`;
          } else {
            // Do NOT fail the entire connection check with a hard throw error if sender email is rejected.
            // The tenant credentials (accessKey, secretKey, host) work. Warn about the sender email clearly.
            senderNote = ` · ⚠️ Sender email "${f.senderEmail}" is not recognized as an active user in this tenant (update sender email or click "Find a working sender")`;
          }
        }
      }
      result = { ok: true, detail: `200 · ${fields.length} lead fields${senderNote} · ${Date.now() - started}ms` };
    } else if (id === 'claude') {
      const f = await resolveTestFields('claude', typedFields);
      if (!f.apiKey) throw new Error('An API key is required.');
      const client = new Anthropic({ apiKey: f.apiKey, timeout: 25_000, maxRetries: 0 });
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
      const res = await fetch(`${(process.env.APOLLO_API_BASE_URL?.trim() || 'https://api.apollo.io/api/v1').replace(/\/+$/, '')}/auth/health`, {
        headers: { 'x-api-key': f.apiKey, 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
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
    } else if (id === 'zoom') {
      const f = await resolveTestFields('zoom', typedFields);
      if (f.accountId && f.clientId && f.clientSecret) {
        // Direct Server-to-Server OAuth test & token retrieval
        const { getServerToServerToken, fetchConnectedUser } = await import('@/lib/zoom/auth');
        const tokenResult = await getServerToServerToken({ accountId: f.accountId, clientId: f.clientId, clientSecret: f.clientSecret });
        await saveIntegrationConfig('zoom', {
          accessToken: tokenResult.accessToken,
          ...(tokenResult.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + tokenResult.expiresInSec * 1000).toISOString() } : {}),
        });
        const user = await fetchConnectedUser(tokenResult.accessToken);
        if (user.email) await saveIntegrationConfig('zoom', { connectedEmail: user.email });
        const label = user.email ? `connected as ${user.email}` : 'token verified';
        result = { ok: true, detail: `200 · Server-to-Server OAuth connected (${label}) · ${Date.now() - started}ms` };
      } else {
        if (!f.accessToken && !f.refreshToken) throw new Error('Live mode needs a connected account — click "Connect with Zoom", or enter Account ID for Server-to-Server OAuth.');
        // A user-managed access token lasts an hour. Testing the saved one as it is reported "Access token is
        // expired" for a connection that renews itself perfectly well, so an expired token is renewed first,
        // the way every real Zoom call does it, and the reason is given when Zoom refuses the renewal.
        const { renewZoomConnection } = await import('@/lib/zoom/client');
        const { ZOOM_API_BASE_URL } = await import('@/lib/zoom/auth');
        let token = f.accessToken;
        let renewed = false;
        const expiresAt = Date.parse(f.tokenExpiresAt ?? '');
        if (!token || (Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000)) {
          const r = await renewZoomConnection();
          if (!r.ok) throw new Error(r.error);
          token = r.accessToken;
          renewed = true;
        }
        const ask = (t: string) => fetch(`${ZOOM_API_BASE_URL}/users/me`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        let res = await ask(token);
        if (res.status === 401 && !renewed) {
          const r = await renewZoomConnection();
          if (!r.ok) throw new Error(r.error);
          renewed = true;
          res = await ask(r.accessToken);
        }
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} · ${text.slice(0, 180)}`);
        let email = '';
        try {
          email = (JSON.parse(text) as { email?: string }).email ?? '';
        } catch {
          // not JSON: the connection still answered
        }
        if (email) await saveIntegrationConfig('zoom', { connectedEmail: email });
        result = { ok: true, detail: `200 · connected${email ? ` as ${email}` : ''}${renewed ? ' · access token renewed automatically' : ''} · ${Date.now() - started}ms` };
      }
    } else if (id === 'linkedin') {
      const f = await resolveTestFields('linkedin', typedFields);
      {
        if (!f.accessToken) throw new Error('Live mode needs an access token — click “Connect with LinkedIn” first.');
        const res = await fetch('https://api.linkedin.com/rest/organizationAcls?q=member&state=APPROVED&count=1', {
          headers: {
            Authorization: `Bearer ${f.accessToken}`,
            'LinkedIn-Version': process.env.LINKEDIN_VERSION || '202608',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} · ${text.slice(0, 180)}`);
        result = { ok: true, detail: `200 · token valid · ${Date.now() - started}ms` };
      }
    } else if (id === 'netcore') {
      const f = await resolveTestFields('netcore', typedFields);
      const { testNetcoreConnection } = await import('@/lib/netcore');
      result = await testNetcoreConnection(f);
    } else {
      result = { ok: false, detail: 'This integration is not supported.' };
    }
  } catch (err) {
    result = { ok: false, detail: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
  if (TESTABLE.includes(id)) {
    await saveTestResult(id, result.ok, result.detail);
    try {
      revalidatePath('/integrations');
    } catch {
      // outside request context
    }
  }
  return result;
}
