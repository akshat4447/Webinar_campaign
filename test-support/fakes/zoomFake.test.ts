// Contract tests for the fake Zoom server (test-support/fakes/zoomFake.ts).
//
// Strict behaviours of the fake are asserted directly over HTTP with fetch.
// The app's REAL Zoom client (lib/zoom/*) is used only for stable flows, with
// tolerant assertions, because that code is being changed in parallel.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { startFakeZoom, FAKE_ZOOM_ALL_SCOPES, type FakeZoom } from './zoomFake';
import { verifyZoomSignature, zoomCrcResponse } from '@/lib/zoom/webhookSecurity';

// ── mocks for the app's client (same pattern as lib/zoom/client.test.ts) ──
const appConfig = new Map<string, string>();
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => appConfig.get(key)),
  saveIntegrationConfig: vi.fn(async (_id: string, fields: Record<string, string>) => {
    for (const [k, v] of Object.entries(fields)) appConfig.set(k, v);
  }),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

type ClientModule = typeof import('@/lib/zoom/client');
type MeetingsModule = typeof import('@/lib/zoom/meetings');
type AuthModule = typeof import('@/lib/zoom/auth');
type RetryModule = typeof import('@/lib/retry');

let fake: FakeZoom;
let client: ClientModule;
let meetings: MeetingsModule;
let auth: AuthModule;
let retry: RetryModule;

beforeAll(async () => {
  fake = await startFakeZoom();
  process.env.ZOOM_API_BASE_URL = fake.apiUrl;
  process.env.ZOOM_OAUTH_BASE_URL = fake.oauthUrl;
  process.env.ZOOM_HOST_EMAIL = fake.config.hostEmail;
  vi.resetModules();
  client = await import('@/lib/zoom/client');
  meetings = await import('@/lib/zoom/meetings');
  auth = await import('@/lib/zoom/auth');
  retry = await import('@/lib/retry');
});

afterAll(async () => {
  await fake.stop();
  delete process.env.ZOOM_API_BASE_URL;
  delete process.env.ZOOM_OAUTH_BASE_URL;
  delete process.env.ZOOM_HOST_EMAIL;
});

beforeEach(() => {
  fake.reset();
  appConfig.clear();
  vi.mocked(retry.sleep).mockClear();
});

// ── helpers ──
const basic = (id = fake?.config.clientId, secret = fake?.config.clientSecret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

interface TokenBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  reason?: string;
  error?: string;
}

async function tokenCall(params: Record<string, string>, authorization = basic()): Promise<{ status: number; body: TokenBody }> {
  const res = await fetch(`${fake.oauthUrl}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: (await res.json()) as TokenBody };
}

const userToken = async () => (await tokenCall({ grant_type: 'authorization_code', code: 'any-code', redirect_uri: 'http://localhost/cb' })).body;
const s2sToken = async () => (await tokenCall({ grant_type: 'account_credentials', account_id: fake.config.accountId })).body;

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

async function api(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult> {
  const res = await fetch(`${fake.apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: res.headers };
}

/** Connects the app's client as a User-managed OAuth account, using the fake's real token endpoint. */
async function connectUserOAuth(): Promise<TokenBody> {
  const t = await auth.exchangeCodeForToken({
    clientId: fake.config.clientId,
    clientSecret: fake.config.clientSecret,
    code: `code-${Math.random()}`,
    redirectUri: 'http://localhost/cb',
  });
  appConfig.set('clientId', fake.config.clientId);
  appConfig.set('clientSecret', fake.config.clientSecret);
  appConfig.set('accessToken', t.accessToken);
  if (t.refreshToken) appConfig.set('refreshToken', t.refreshToken);
  appConfig.set('tokenExpiresAt', new Date(Date.now() + (t.expiresInSec ?? 3600) * 1000).toISOString());
  appConfig.set('mode', 'live');
  return { access_token: t.accessToken, refresh_token: t.refreshToken, expires_in: t.expiresInSec ?? 0, token_type: 'bearer', scope: '' };
}

function connectServerToServer(): void {
  appConfig.set('clientId', fake.config.clientId);
  appConfig.set('clientSecret', fake.config.clientSecret);
  appConfig.set('accountId', fake.config.accountId);
  appConfig.set('mode', 'live');
}

const grantsLogged = (grant: string) =>
  fake.state.requestLog.filter((e) => e.area === 'oauth' && e.path === '/oauth/token' && (e.body as Record<string, string> | undefined)?.grant_type === grant);

const inFuture = (days: number) => new Date(Date.now() + days * 864e5).toISOString();

// ═════════════════════════ OAuth ═════════════════════════

describe('fake Zoom OAuth', () => {
  it('rejects bad client credentials with the real invalid_client body', async () => {
    const r = await tokenCall({ grant_type: 'authorization_code', code: 'x' }, basic('fake-client-id', 'WRONG'));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
    const none = await fetch(`${fake.oauthUrl}/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: 'x' }) });
    expect(none.status).toBe(401);
  });

  it('accepts any authorization code and returns a refreshable bearer token', async () => {
    const r = await tokenCall({ grant_type: 'authorization_code', code: 'literally-anything', redirect_uri: 'http://x/cb' });
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe('bearer');
    expect(r.body.expires_in).toBeGreaterThan(3590);
    expect(r.body.expires_in).toBeLessThanOrEqual(3600);
    expect(r.body.refresh_token).toBeTruthy();
    expect(r.body.scope.split(' ')).toEqual(FAKE_ZOOM_ALL_SCOPES);
    expect((await tokenCall({ grant_type: 'authorization_code' })).status).toBe(400);
  });

  it('ROTATES the refresh token: the old one stops working', async () => {
    const first = await userToken();
    const second = await tokenCall({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string });
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).toBeTruthy();
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect(second.body.access_token).not.toBe(first.access_token);

    const reuse = await tokenCall({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_request');

    const third = await tokenCall({ grant_type: 'refresh_token', refresh_token: second.body.refresh_token as string });
    expect(third.status).toBe(200);
    expect((await tokenCall({ grant_type: 'refresh_token', refresh_token: 'made-up' })).status).toBe(400);
  });

  it('supports Server-to-Server account_credentials (account_id required, no refresh token), also via query string', async () => {
    expect((await tokenCall({ grant_type: 'account_credentials' })).status).toBe(400);
    expect((await tokenCall({ grant_type: 'account_credentials', account_id: 'someone-else' })).status).toBe(400);
    const ok = await tokenCall({ grant_type: 'account_credentials', account_id: fake.config.accountId });
    expect(ok.status).toBe(200);
    expect(ok.body.refresh_token).toBeUndefined();

    const viaQuery = await fetch(`${fake.oauthUrl}/oauth/token?grant_type=account_credentials&account_id=${fake.config.accountId}`, {
      method: 'POST',
      headers: { Authorization: basic() },
    });
    expect(viaQuery.status).toBe(200);
  });

  it('rejects unknown grant types', async () => {
    const r = await tokenCall({ grant_type: 'password' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('unsupported_grant_type');
    expect((await tokenCall({})).body.reason).toBe('Missing grant type');
  });

  it('authorize endpoint redirects back with code + state; strictAuthCodes makes codes single-use', async () => {
    const url = `${fake.oauthUrl}/oauth/authorize?response_type=code&client_id=${fake.config.clientId}&redirect_uri=${encodeURIComponent('http://localhost:3000/cb')}&state=abc123`;
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') as string);
    expect(loc.origin + loc.pathname).toBe('http://localhost:3000/cb');
    expect(loc.searchParams.get('state')).toBe('abc123');
    const code = loc.searchParams.get('code') as string;
    expect(code).toBeTruthy();

    expect((await fetch(url.replace(fake.config.clientId, 'nope'), { redirect: 'manual' })).status).toBe(400);

    fake.config.strictAuthCodes = true;
    expect((await tokenCall({ grant_type: 'authorization_code', code: 'invented', redirect_uri: 'http://localhost:3000/cb' })).status).toBe(400);
    expect((await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: 'http://other/cb' })).status).toBe(400);
    expect((await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:3000/cb' })).status).toBe(200);
    expect((await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:3000/cb' })).status).toBe(400);
  });

  it('expired / forged / missing tokens get 401 code 124; expireAllTokens and advanceTime both expire', async () => {
    const t = await userToken();
    expect((await api('/users/me', t.access_token)).status).toBe(200);

    fake.expireAllTokens();
    const expired = await api('/users/me', t.access_token);
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({ code: 124, message: 'Invalid access token.' });

    expect((await api('/users/me', 'forged')).body.code).toBe(124);
    expect((await fetch(`${fake.apiUrl}/users/me`)).status).toBe(401);

    const t2 = await userToken();
    expect((await api('/users/me', t2.access_token)).status).toBe(200);
    fake.advanceTime(3601 * 1000);
    expect((await api('/users/me', t2.access_token)).status).toBe(401);
  });

  it('honours a custom token lifetime', async () => {
    fake.config.tokenTtlSec = 120;
    const t = await userToken();
    expect(t.expires_in).toBeLessThanOrEqual(120);
    fake.advanceTime(121_000);
    expect((await api('/users/me', t.access_token)).status).toBe(401);
  });
});

// ═════════════════════════ users ═════════════════════════

describe('fake Zoom users', () => {
  it('GET /users/me for a user token; by id and by email; unknown user 404', async () => {
    const t = await userToken();
    const me = await api('/users/me', t.access_token);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(fake.config.hostEmail);
    expect((await api(`/users/${encodeURIComponent(fake.config.hostEmail.toUpperCase())}`, t.access_token)).body.id).toBe(me.body.id);
    expect((await api(`/users/${me.body.id as string}`, t.access_token)).status).toBe(200);
    const nobody = await api('/users/nobody@example.com', t.access_token);
    expect(nobody.status).toBe(404);
    expect(nobody.body.code).toBe(1001);
  });

  it('a Server-to-Server token cannot use `me` (must use the user id / email)', async () => {
    const s = await s2sToken();
    const me = await api('/users/me', s.access_token);
    expect(me.status).toBe(400);
    expect(me.body.code).toBe(1010);
    expect((await api('/users/me/meetings', s.access_token)).status).toBe(400);
    expect((await api(`/users/${fake.config.hostEmail}`, s.access_token)).status).toBe(200);
    expect((await api(`/users/${fake.config.hostEmail}/meetings`, s.access_token)).status).toBe(200);
  });
});

// ═════════════════════════ meetings ═════════════════════════

describe('fake Zoom meetings', () => {
  it('create defaults to approval_type 2 (NO registration) and has no registration_url', async () => {
    const t = await userToken();
    const r = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'T', type: 2, start_time: inFuture(1), duration: 45, settings: { join_before_host: false } } });
    expect(r.status).toBe(201);
    expect(typeof r.body.id).toBe('number');
    expect(String(r.body.id)).toMatch(/^\d{9,11}$/);
    expect(r.body.uuid).toBeTruthy();
    expect(r.body.topic).toBe('T');
    expect(r.body.duration).toBe(45);
    expect(r.body.join_url).toMatch(/\/j\/\d+\?pwd=/);
    expect(r.body.password).toBeTruthy();
    expect(r.body.registration_url).toBeUndefined();
    expect((r.body.settings as Record<string, unknown>).approval_type).toBe(2);
  });

  it('approval_type 0/1 + registration_type enables registration and returns registration_url', async () => {
    const t = await userToken();
    for (const approval of [0, 1]) {
      const r = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'R', type: 2, settings: { approval_type: approval, registration_type: 1 } } });
      expect(r.status).toBe(201);
      expect((r.body.settings as Record<string, unknown>).approval_type).toBe(approval);
      expect(r.body.registration_url).toMatch(/\/meeting\/register\//);
    }
    // registration_type alone (without approval_type) does NOT enable anything
    const trap = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'X', settings: { registration_type: 1 } } });
    expect(trap.body.registration_url).toBeUndefined();
    expect((trap.body.settings as Record<string, unknown>).approval_type).toBe(2);
  });

  it('unlicensed host: registration settings are SILENTLY ignored (on create and on PATCH)', async () => {
    fake.config.hostLicensed = false;
    const t = await userToken();
    const r = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'Basic', settings: { approval_type: 0, registration_type: 1 } } });
    expect(r.status).toBe(201);
    expect((r.body.settings as Record<string, unknown>).approval_type).toBe(2);
    expect(r.body.registration_url).toBeUndefined();

    expect((await api(`/meetings/${r.body.id as number}`, t.access_token, { method: 'PATCH', body: { settings: { approval_type: 0 } } })).status).toBe(204);
    const after = await api(`/meetings/${r.body.id as number}`, t.access_token);
    expect((after.body.settings as Record<string, unknown>).approval_type).toBe(2);

    const reg = await api(`/meetings/${r.body.id as number}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } });
    expect(reg.status).toBe(400);
    expect(reg.body.code).toBe(3027);

    // a meeting that DOES have registration on (e.g. created before a downgrade) still refuses a basic host
    const seeded = fake.seedMeeting({ approval_type: 0 });
    const reg2 = await api(`/meetings/${seeded.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } });
    expect(reg2.status).toBe(400);
    expect(reg2.body.code).toBe(200);
  });

  it('validates the create body', async () => {
    const t = await userToken();
    const bad = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'x'.repeat(201), start_time: 'not-a-date', settings: { approval_type: 7 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe(300);
    expect((bad.body.errors as Array<{ field: string }>).map((e) => e.field).sort()).toEqual(['settings.approval_type', 'start_time', 'topic']);
    const raw = await fetch(`${fake.apiUrl}/users/me/meetings`, { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}` }, body: '{not json' });
    expect(raw.status).toBe(400);
  });

  it('normalises start_time (ms stripped) like Zoom does', async () => {
    const t = await userToken();
    const r = await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'T', start_time: '2030-01-02T03:04:05.678Z' } });
    expect(r.body.start_time).toBe('2030-01-02T03:04:05Z');
  });

  it('GET /meetings/{id}, PATCH enables registration (204), DELETE removes it', async () => {
    const t = await userToken();
    const created = (await api('/users/me/meetings', t.access_token, { method: 'POST', body: { topic: 'Orig' } })).body;
    const id = created.id as number;

    const got = await api(`/meetings/${id}`, t.access_token);
    expect(got.status).toBe(200);
    expect(got.body.host_email).toBe(fake.config.hostEmail);
    expect(got.body.registration_url).toBeUndefined();

    const patch = await fetch(`${fake.apiUrl}/meetings/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'New', settings: { approval_type: 0, registration_type: 1 } }),
    });
    expect(patch.status).toBe(204);
    expect(await patch.text()).toBe('');
    const again = await api(`/meetings/${id}`, t.access_token);
    expect(again.body.topic).toBe('New');
    expect(again.body.registration_url).toBeTruthy();

    expect((await api(`/meetings/${id}`, t.access_token, { method: 'DELETE' })).status).toBe(204);
    const gone = await api(`/meetings/${id}`, t.access_token);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe(3001);
    expect((await api('/meetings/abc', t.access_token)).status).toBe(400);
  });

  it('lists upcoming meetings with page_size + next_page_token; excludes ended; rejects bad tokens', async () => {
    fake.config.maxPageSize = 300;
    const t = await userToken();
    for (let i = 0; i < 5; i++) fake.seedMeeting({ topic: `M${i}`, start_time: inFuture(i + 1) });
    const ended = fake.seedMeeting({ topic: 'old', start_time: inFuture(-3) });
    fake.endMeeting(ended.id);

    const seen: string[] = [];
    let next = '';
    let pages = 0;
    do {
      const r = await api(`/users/me/meetings?type=upcoming&page_size=2${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`, t.access_token);
      expect(r.status).toBe(200);
      expect(r.body.page_size).toBe(2);
      for (const m of r.body.meetings as Array<{ topic: string }>) seen.push(m.topic);
      next = r.body.next_page_token as string;
      pages++;
    } while (next);
    expect(pages).toBe(3);
    expect(seen).toEqual(['M0', 'M1', 'M2', 'M3', 'M4']);

    expect((await api('/users/me/meetings?next_page_token=garbage', t.access_token)).status).toBe(400);
    expect((await api('/users/me/meetings?page_size=0', t.access_token)).status).toBe(400);
    expect((await api('/users/me/meetings?type=bogus', t.access_token)).status).toBe(400);
    const prev = await api('/users/me/meetings?type=previous_meetings', t.access_token);
    expect((prev.body.meetings as unknown[]).length).toBe(1);
  });

  it('clamps page_size to the server maximum', async () => {
    fake.config.maxPageSize = 3;
    const t = await userToken();
    for (let i = 0; i < 7; i++) fake.seedMeeting({ start_time: inFuture(1) });
    const r = await api('/users/me/meetings?page_size=300', t.access_token);
    expect(r.body.page_size).toBe(3);
    expect((r.body.meetings as unknown[]).length).toBe(3);
    expect(r.body.next_page_token).toBeTruthy();
    expect(r.body.total_records).toBe(7);
  });
});

// ═════════════════════════ webinars ═════════════════════════

describe('fake Zoom webinars', () => {
  it('answers "Webinar plan is missing" without the add-on, on every webinar endpoint', async () => {
    const t = await userToken();
    const list = await api('/users/me/webinars', t.access_token);
    expect(list.status).toBe(400);
    expect(list.body).toEqual({ code: 200, message: 'Webinar plan is missing' });
    expect((await api('/webinars/123', t.access_token)).body.code).toBe(200);
    expect((await api('/webinars/123/registrants', t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } })).body.code).toBe(200);
  });

  it('with the add-on: create / list / get / panelists / registrants; meetings and webinars are separate namespaces', async () => {
    fake.config.webinarAddOn = true;
    const t = await userToken();
    const created = await api('/users/me/webinars', t.access_token, { method: 'POST', body: { topic: 'Web', type: 5, settings: { approval_type: 0 } } });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe(5);
    expect(created.body.registration_url).toMatch(/\/webinar\/register\//);
    const id = created.body.id as number;

    const list = await api('/users/me/webinars', t.access_token);
    expect((list.body.webinars as Array<{ id: number }>).map((w) => w.id)).toEqual([id]);

    const meeting = fake.seedMeeting({ topic: 'plain' });
    expect((await api(`/webinars/${meeting.id}`, t.access_token)).status).toBe(404);
    expect((await api(`/meetings/${id}`, t.access_token)).status).toBe(404);
    expect((await api(`/webinars/${meeting.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } })).status).toBe(404);

    fake.seedPanelists(id, [{ name: 'Pat Panel', email: 'pat@x.co' }]);
    const panel = await api(`/webinars/${id}/panelists`, t.access_token);
    expect((panel.body.panelists as Array<{ name: string }>)[0].name).toBe('Pat Panel');

    const reg = await api(`/webinars/${id}/registrants`, t.access_token, { method: 'POST', body: { email: 'w@x.co', first_name: 'W' } });
    expect(reg.status).toBe(201);
    expect(reg.body.join_url).toMatch(/tk=/);
  });

  it('tracking_sources: POST is a 404 (no such Zoom API), GET is an empty list', async () => {
    fake.config.webinarAddOn = true;
    const t = await userToken();
    const w = fake.seedMeeting({ kind: 'webinar', approval_type: 0 });
    expect((await api(`/webinars/${w.id}/tracking_sources`, t.access_token, { method: 'POST', body: { source_name: 'x' } })).status).toBe(404);
    const g = await api(`/webinars/${w.id}/tracking_sources`, t.access_token);
    expect(g.status).toBe(200);
    expect(g.body).toEqual({ tracking_sources: [] });
  });
});

// ═════════════════════════ registrants ═════════════════════════

describe('fake Zoom registrants', () => {
  const body = (email = 'jane@acme.co', first = 'Jane') => ({ email, first_name: first, last_name: '' });

  it('approval_type 2 -> 400 code 3027 "Registration has not been enabled"; works once enabled via PATCH', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ topic: 'No reg' });
    const r = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body() });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: 3027, message: `Registration has not been enabled for this meeting: ${m.id}.` });

    await api(`/meetings/${m.id}`, t.access_token, { method: 'PATCH', body: { settings: { approval_type: 0 } } });
    const ok = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body() });
    expect(ok.status).toBe(201);
    expect(ok.body.id).toBe(m.id);
    expect(ok.body.registrant_id).toBeTruthy();
    expect(ok.body.topic).toBe('No reg');
    expect(ok.body.join_url).toMatch(/[?&]tk=/);
  });

  it('same email twice returns the EXISTING registrant (same id + join_url), case-insensitively', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    const a = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('Jane@Acme.co') });
    const b = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('jane@acme.co') });
    expect(b.status).toBe(201);
    expect(b.body.registrant_id).toBe(a.body.registrant_id);
    expect(b.body.join_url).toBe(a.body.join_url);
    expect(fake.state.registrants.get(m.id)).toHaveLength(1);
  });

  it('validates email and first_name (code 300), last_name optional', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    const badEmail = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('not-an-email') });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.code).toBe(300);
    expect(badEmail.body.message).toBe('Validation Failed.');
    const noFirst = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co' } });
    expect(noFirst.status).toBe(400);
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } })).status).toBe(201);
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'c@b.co', first_name: '🙂'.repeat(70) } })).status).toBe(400);
  });

  it('registrant cap -> 400 code 3001; an already-registered email at the cap is still returned', async () => {
    fake.config.maxRegistrants = 2;
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    for (const e of ['a@x.co', 'b@x.co']) expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body(e) })).status).toBe(201);
    const full = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('c@x.co') });
    expect(full.status).toBe(400);
    expect(full.body.code).toBe(3001);
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('a@x.co') })).status).toBe(201);
  });

  it('registrants_restrict_number on the event also caps it', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0, registrants_restrict_number: 1 });
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('a@x.co') })).status).toBe(201);
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body('b@x.co') })).status).toBe(400);
  });

  it('manual approval (1): registrant is pending with no join_url until approved', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 1 });
    const r = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body() });
    expect(r.status).toBe(201);
    expect(r.body.join_url).toBeUndefined();
    const pending = await api(`/meetings/${m.id}/registrants?status=pending`, t.access_token);
    expect(pending.body.total_records).toBe(1);

    const put = await fetch(`${fake.apiUrl}/meetings/${m.id}/registrants/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', registrants: [{ id: r.body.registrant_id, email: 'jane@acme.co' }] }),
    });
    expect(put.status).toBe(204);
    const approved = await api(`/meetings/${m.id}/registrants?status=approved`, t.access_token);
    expect((approved.body.registrants as Array<{ join_url: string }>)[0].join_url).toMatch(/tk=/);
  });

  it('lists registrants paged with a status filter', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    for (let i = 0; i < 5; i++) fake.seedRegistrant(m.id, { email: `u${i}@x.co`, first_name: `U${i}` });
    fake.seedRegistrant(m.id, { email: 'denied@x.co', first_name: 'D', status: 'denied' });

    const emails: string[] = [];
    let next = '';
    do {
      const r = await api(`/meetings/${m.id}/registrants?status=approved&page_size=2${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`, t.access_token);
      expect(r.status).toBe(200);
      for (const x of r.body.registrants as Array<{ email: string }>) emails.push(x.email);
      next = r.body.next_page_token as string;
    } while (next);
    expect(emails).toEqual(['u0@x.co', 'u1@x.co', 'u2@x.co', 'u3@x.co', 'u4@x.co']);
    expect((await api(`/meetings/${m.id}/registrants?status=denied`, t.access_token)).body.total_records).toBe(1);
    expect((await api(`/meetings/${m.id}/registrants?status=weird`, t.access_token)).status).toBe(400);
  });

  it('registering for an ended meeting is refused', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.endMeeting(m.id);
    expect((await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: body() })).status).toBe(400);
  });
});

// ═════════════════════════ scopes ═════════════════════════

describe('fake Zoom scopes', () => {
  it('missing scope -> 400 code 4711 with the exact Zoom wording (user token)', async () => {
    fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => s !== 'meeting:write:registrant');
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    const r = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: 4711, message: 'Invalid access token, does not contain scopes:[meeting:write:registrant].' });
    // other scopes still work
    expect((await api(`/meetings/${m.id}`, t.access_token)).status).toBe(200);
  });

  it('S2S tokens report the :admin variant of the missing scope; :admin scopes satisfy the check', async () => {
    fake.config.scopes = ['meeting:read:meeting:admin', 'user:read:user:admin'];
    const s = await s2sToken();
    const m = fake.seedMeeting();
    expect((await api(`/meetings/${m.id}`, s.access_token)).status).toBe(200);
    const r = await api(`/users/${fake.config.hostEmail}/meetings`, s.access_token, { method: 'POST', body: { topic: 'x' } });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Invalid access token, does not contain scopes:[meeting:write:meeting:admin].');
  });

  it('scopes are fixed at issue time; a re-issued token picks up new scopes', async () => {
    const t = await userToken();
    fake.config.scopes = ['user:read:user'];
    expect((await api('/users/me/meetings', t.access_token)).status).toBe(200);
    const t2 = await userToken();
    expect((await api('/users/me/meetings', t2.access_token)).status).toBe(400);
  });
});

// ═════════════════════════ past participants ═════════════════════════

describe('fake Zoom past participants', () => {
  it('404 code 3001 until the meeting has ended; rows are one per join session', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ start_time: inFuture(-1) });
    expect((await api(`/past_meetings/${m.id}/participants`, t.access_token)).status).toBe(404);
    expect((await api('/past_meetings/99999999999/participants', t.access_token)).body.code).toBe(3001);

    fake.seedPastParticipants(m.id, [
      { name: 'Ann', user_email: 'ann@x.co', duration: 600 },
      { name: 'Ann', user_email: 'ann@x.co', duration: 1200 }, // re-joined
      { name: 'Guest', duration: 30 },
    ]);
    const ev = fake.endMeeting(m.id);
    expect(ev.event).toBe('meeting.ended');

    const r = await api(`/past_meetings/${m.id}/participants`, t.access_token);
    expect(r.status).toBe(200);
    expect(r.body.total_records).toBe(3);
    const rows = r.body.participants as Array<{ name: string; user_email: string; duration: number; join_time: string; leave_time: string }>;
    expect(rows.map((x) => x.name)).toEqual(['Ann', 'Ann', 'Guest']);
    expect(rows[2].user_email).toBe('');
    expect(Date.parse(rows[0].leave_time) - Date.parse(rows[0].join_time)).toBe(600_000);

    // by uuid too
    expect((await api(`/past_meetings/${encodeURIComponent(m.uuid)}/participants`, t.access_token)).status).toBe(200);
  });

  it('pages with next_page_token', async () => {
    fake.config.maxPageSize = 2;
    const t = await userToken();
    const m = fake.seedMeeting();
    fake.seedPastParticipants(m.id, Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, duration: 60 })));
    fake.endMeeting(m.id);
    const names: string[] = [];
    let next = '';
    do {
      const r = await api(`/past_meetings/${m.id}/participants?page_size=300${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`, t.access_token);
      for (const p of r.body.participants as Array<{ name: string }>) names.push(p.name);
      next = r.body.next_page_token as string;
    } while (next);
    expect(names).toEqual(['P0', 'P1', 'P2', 'P3', 'P4']);
  });
});

// ═════════════════════════ rate limit, faults, log ═════════════════════════

describe('fake Zoom rate limiting', () => {
  it('returns 429 + Retry-After above perSecond (REST only, not OAuth)', async () => {
    const t = await userToken();
    fake.config.rateLimit = { perSecond: 2 };
    expect((await api('/users/me', t.access_token)).status).toBe(200);
    expect((await api('/users/me', t.access_token)).status).toBe(200);
    const limited = await api('/users/me', t.access_token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(fake.state.requestLog.at(-1)?.rateLimited).toBe(true);
    expect((await tokenCall({ grant_type: 'account_credentials', account_id: fake.config.accountId })).status).toBe(200);
  });
});

describe('fake Zoom fault injection', () => {
  it('times: N affects exactly N matching requests, in order, then passes through', async () => {
    const t = await userToken();
    fake.setFault({ match: '/users/me', status: 500, times: 1 });
    fake.setFault({ match: '/users/me', status: 503, body: { code: 503, message: 'down' }, times: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await api('/users/me', t.access_token)).status);
    expect(codes).toEqual([500, 503, 503, 200, 200]);
    expect(fake.state.faults).toHaveLength(0);
    expect(fake.state.requestLog.filter((e) => e.faulted)).toHaveLength(3);
  });

  it('matches by glob / regexp / method; forever until cleared; custom headers and body', async () => {
    const t = await userToken();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.setFault({ match: '/meetings/*/registrants', method: 'post', status: 429, headers: { 'Retry-After': '3' }, times: 'forever', body: { code: 429, message: 'slow down' } });
    fake.setFault({ match: /^\/users\/.+\/meetings$/, status: 502, times: 'forever' });
    const post = await api(`/meetings/${m.id}/registrants`, t.access_token, { method: 'POST', body: { email: 'a@b.co', first_name: 'A' } });
    expect(post.status).toBe(429);
    expect(post.headers.get('retry-after')).toBe('3');
    expect(post.body.message).toBe('slow down');
    expect((await api(`/meetings/${m.id}`, t.access_token)).status).toBe(200); // GET meeting not matched
    expect((await api('/users/me/meetings', t.access_token)).status).toBe(502);
    expect((await api('/users/me/meetings', t.access_token)).status).toBe(502);
    fake.clearFaults();
    expect((await api('/users/me/meetings', t.access_token)).status).toBe(200);
  });

  it('delayMs delays; delay-only faults then answer normally', async () => {
    const t = await userToken();
    fake.setFault({ match: '/users/me', delayMs: 120 });
    const t0 = Date.now();
    const r = await api('/users/me', t.access_token);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(r.status).toBe(200);
  });

  it('dropConnection kills the socket', async () => {
    const t = await userToken();
    fake.setFault({ match: '/users/me', dropConnection: true });
    await expect(api('/users/me', t.access_token)).rejects.toThrow();
    expect((await api('/users/me', t.access_token)).status).toBe(200);
    expect(fake.state.requestLog.find((e) => e.faulted)?.status).toBe(0);
  });

  it('can fault the OAuth endpoint too', async () => {
    fake.setFault({ match: '/oauth/token', status: 500, body: { reason: 'boom', error: 'server_error' } });
    expect((await tokenCall({ grant_type: 'account_credentials', account_id: fake.config.accountId })).status).toBe(500);
    expect((await tokenCall({ grant_type: 'account_credentials', account_id: fake.config.accountId })).status).toBe(200);
  });

  it('records requests and reset() clears state, faults and config changes', async () => {
    const t = await userToken();
    fake.config.hostLicensed = false;
    fake.seedMeeting();
    fake.setFault({ match: '*', status: 500, times: 'forever' });
    fake.reset();
    expect(fake.state.meetings.size).toBe(0);
    expect(fake.state.tokens).toHaveLength(0);
    expect(fake.state.requestLog).toHaveLength(0);
    expect(fake.state.faults).toHaveLength(0);
    expect(fake.config.hostLicensed).toBe(true);
    expect((await api('/users/me', t.access_token)).status).toBe(401); // token is gone
    const t2 = await userToken();
    await api('/users/me?x=1', t2.access_token);
    const last = fake.state.requestLog.at(-1);
    expect(last).toMatchObject({ method: 'GET', path: '/users/me', area: 'api', status: 200, query: { x: '1' } });
  });
});

// ═════════════════════════ the app's real client against the fake ═════════════════════════

describe('app Zoom client against the fake', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('401 -> refresh (rotating refresh token) -> retry succeeds, and the rotated token is persisted', async () => {
    const first = await connectUserOAuth();
    fake.expireAllTokens();
    const me = await client.zoomRequest<{ email: string }>('/users/me');
    expect(me.email).toBe(fake.config.hostEmail);
    expect(grantsLogged('refresh_token')).toHaveLength(1);
    expect(appConfig.get('refreshToken')).not.toBe(first.refresh_token);
    expect(appConfig.get('accessToken')).not.toBe(first.access_token);
  });

  it('survives many refresh cycles against rotating refresh tokens', async () => {
    await connectUserOAuth();
    for (let i = 0; i < 4; i++) {
      fake.expireAllTokens();
      await expect(client.zoomRequest('/users/me')).resolves.toMatchObject({ email: fake.config.hostEmail });
    }
    expect(grantsLogged('refresh_token')).toHaveLength(4);
    expect([...fake.state.refreshTokens.values()].filter((r) => !r.used)).toHaveLength(1);
  });

  it('concurrent 401s share ONE refresh (single-flight) — a second concurrent refresh would burn the rotated token', async () => {
    await connectUserOAuth();
    fake.expireAllTokens();
    const results = await Promise.all([1, 2, 3, 4].map(() => client.zoomRequest<{ email: string }>('/users/me')));
    for (const r of results) expect(r.email).toBe(fake.config.hostEmail);
    expect(grantsLogged('refresh_token')).toHaveLength(1);
    expect(fake.state.requestLog.filter((e) => e.area === 'oauth' && e.status !== 200)).toHaveLength(0);
  });

  it('a dead refresh token (rotated elsewhere) cannot recover: the call fails with a 401 ZoomError', async () => {
    await connectUserOAuth();
    fake.expireAllTokens();
    // someone else (e.g. a second app instance) consumed our refresh token
    await tokenCall({ grant_type: 'refresh_token', refresh_token: appConfig.get('refreshToken') as string });
    await expect(client.zoomRequest('/users/me')).rejects.toMatchObject({ name: 'ZoomError', status: 401 });
  });

  it('Server-to-Server: bootstraps a token, refreshes on 401, and `me` is rejected like real Zoom', async () => {
    connectServerToServer();
    await expect(client.zoomRequest('/users/me')).rejects.toMatchObject({ status: 400 });
    expect(grantsLogged('account_credentials')).toHaveLength(1);
    const host = fake.config.hostEmail;
    await expect(client.zoomRequest(`/users/${host}`)).resolves.toMatchObject({ email: host });
    fake.expireAllTokens();
    await expect(client.zoomRequest(`/users/${host}`)).resolves.toMatchObject({ email: host });
    expect(grantsLogged('account_credentials')).toHaveLength(2);
  });

  it('retries 429 honouring Retry-After (even for POST)', async () => {
    await connectUserOAuth();
    fake.setFault({ match: '/users/*', status: 429, headers: { 'Retry-After': '2' }, times: 2 });
    await expect(client.zoomRequest('/users/me')).resolves.toMatchObject({ email: fake.config.hostEmail });
    expect(retry.sleep).toHaveBeenCalledTimes(2);
    expect(retry.sleep).toHaveBeenCalledWith(2000);

    const m = fake.seedMeeting({ approval_type: 0 });
    vi.mocked(retry.sleep).mockClear();
    fake.setFault({ match: `/meetings/${m.id}/registrants`, status: 429, headers: { 'Retry-After': '1' }, times: 1 });
    const reg = await client.zoomRequest<{ registrant_id: string }>(`/meetings/${m.id}/registrants`, { method: 'POST', body: JSON.stringify({ email: 'a@b.co', first_name: 'A' }) });
    expect(reg.registrant_id).toBeTruthy();
    expect(fake.state.registrants.get(m.id)).toHaveLength(1);
  });

  it('retries 5xx and dropped connections for GET, but never replays a POST', async () => {
    await connectUserOAuth();
    fake.setFault({ match: '/users/me', status: 503, times: 1 });
    fake.setFault({ match: '/users/me', dropConnection: true, times: 1 });
    await expect(client.zoomRequest('/users/me')).resolves.toMatchObject({ email: fake.config.hostEmail });

    fake.clearFaults();
    fake.state.requestLog.length = 0;
    fake.setFault({ match: '/users/*/meetings', method: 'POST', status: 503, times: 1 });
    await expect(client.zoomRequest('/users/me/meetings', { method: 'POST', body: JSON.stringify({ topic: 'x' }) })).rejects.toMatchObject({ status: 503 });
    expect(fake.state.requestLog.filter((e) => e.method === 'POST' && e.path.endsWith('/meetings'))).toHaveLength(1);
    expect(fake.state.meetings.size).toBe(0);
  });

  it('a missing scope surfaces the app\'s "does not contain scopes" guidance', async () => {
    fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => s !== 'meeting:write:registrant');
    await connectUserOAuth();
    const m = fake.seedMeeting({ approval_type: 0 });
    await expect(client.zoomRequest(`/meetings/${m.id}/registrants`, { method: 'POST', body: JSON.stringify({ email: 'a@b.co', first_name: 'A' }) })).rejects.toThrow(
      /does not contain scopes:\[meeting:write:registrant\].*Missing permissions/
    );
    const res = await meetings.addZoomRegistrant(String(m.id), { email: 'a@b.co', firstName: 'A' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('does not contain scopes');
  });

  it('listUpcomingMeetings follows next_page_token across pages (and tolerates a missing webinar plan)', async () => {
    fake.config.maxPageSize = 2;
    await connectUserOAuth();
    for (let i = 0; i < 5; i++) fake.seedMeeting({ topic: `Upcoming ${i}`, start_time: inFuture(i + 1) });
    const ended = fake.seedMeeting({ topic: 'finished', start_time: inFuture(-2) });
    fake.endMeeting(ended.id);

    const list = await meetings.listUpcomingMeetings();
    const topics = list.filter((m) => m.type === 'meeting').map((m) => m.topic);
    expect(topics).toEqual(['Upcoming 0', 'Upcoming 1', 'Upcoming 2', 'Upcoming 3', 'Upcoming 4']);
    const calls = fake.state.requestLog.filter((e) => e.area === 'api' && /\/meetings$/.test(e.path) && e.path.startsWith('/users/'));
    expect(calls).toHaveLength(3);
    expect(warn).toHaveBeenCalled(); // webinar listing failed: add-on missing
  });

  it('listUpcomingMeetings includes webinars when the add-on exists', async () => {
    fake.config.webinarAddOn = true;
    await connectUserOAuth();
    fake.seedMeeting({ kind: 'webinar', topic: 'Big webinar', start_time: inFuture(3) });
    fake.seedMeeting({ topic: 'Small meeting', start_time: inFuture(2) });
    const list = await meetings.listUpcomingMeetings();
    expect(list.map((m) => `${m.type}:${m.topic}`).sort()).toEqual(['meeting:Small meeting', 'webinar:[Webinar] Big webinar']);
  });

  it('createMeeting creates a meeting on the fake and returns its id and join url', async () => {
    await connectUserOAuth();
    const m = await meetings.createMeeting({ topic: 'Created by app', startTime: new Date(Date.now() + 864e5), durationMinutes: 30, agenda: 'hi' });
    expect(m.id).toMatch(/^\d{9,11}$/);
    expect(m.joinUrl).toContain('/j/');
    const stored = fake.state.meetings.get(Number(m.id));
    expect(stored?.topic).toBe('Created by app');
    expect(stored?.duration).toBe(30);
    expect(stored?.agenda).toBe('hi');
  });

  it('getZoomEventDetails resolves a meeting (webinar endpoint refused) and a webinar (with panelists)', async () => {
    await connectUserOAuth();
    const m = fake.seedMeeting({ topic: 'Details meeting', start_time: inFuture(1) });
    const viaUrl = await meetings.getZoomEventDetails(`https://zoom.us/j/${m.id}?pwd=abc`);
    expect(viaUrl).toMatchObject({ id: String(m.id), type: 'meeting', topic: 'Details meeting' });
    expect(viaUrl?.host?.email).toBe(fake.config.hostEmail);
    expect(await meetings.getZoomEventDetails('99999999999')).toBeNull();

    fake.config.webinarAddOn = true;
    const w = fake.seedMeeting({ kind: 'webinar', topic: 'Details webinar', approval_type: 0, registrants_restrict_number: 250 });
    fake.seedPanelists(w.id, [{ name: 'Pat Panel', email: 'pat@x.co' }]);
    const wd = await meetings.getZoomEventDetails(String(w.id));
    expect(wd).toMatchObject({ type: 'webinar', topic: 'Details webinar', capacity: 250 });
    expect(wd?.registrationUrl).toMatch(/\/webinar\/register\//);
    expect(wd?.speakers?.map((s) => s.name)).toContain('Pat Panel');
  });

  it('addZoomRegistrant: personal join url on a registration-enabled meeting; idempotent; reproduces the approval_type 2 trap', async () => {
    await connectUserOAuth();
    const on = fake.seedMeeting({ approval_type: 0 });
    const a = await meetings.addZoomRegistrant(String(on.id), { email: 'Sam@Acme.co', firstName: 'Sam', lastName: 'Lee' });
    expect(a.ok).toBe(true);
    expect(a.joinUrl).toMatch(/tk=/);
    const again = await meetings.addZoomRegistrant(String(on.id), { email: 'sam@acme.co', firstName: 'Sam' });
    expect(again).toMatchObject({ ok: true, joinUrl: a.joinUrl, registrantId: a.registrantId });

    const off = fake.seedMeeting();
    const trap = await meetings.addZoomRegistrant(String(off.id), { email: 'sam@acme.co', firstName: 'Sam' });
    expect(trap.ok).toBe(false);
    expect(trap.error).toContain('3027');
    expect(trap.error).toContain('Registration has not been enabled');
  });

  it('addZoomRegistrant on a webinar id uses the webinar endpoint when the add-on exists', async () => {
    fake.config.webinarAddOn = true;
    await connectUserOAuth();
    const w = fake.seedMeeting({ kind: 'webinar', approval_type: 0 });
    const r = await meetings.addZoomRegistrant(String(w.id), { email: 'w@x.co', firstName: 'W' });
    expect(r.ok).toBe(true);
    expect(fake.state.registrants.get(w.id)).toHaveLength(1);
    // and falls back to /meetings/ for a plain meeting id
    const m = fake.seedMeeting({ approval_type: 0 });
    expect((await meetings.addZoomRegistrant(String(m.id), { email: 'm@x.co', firstName: 'M' })).ok).toBe(true);
  });

  it('manual-approval registrants have no join url yet -> the app reports it could not obtain one', async () => {
    await connectUserOAuth();
    const m = fake.seedMeeting({ approval_type: 1 });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'p@x.co', firstName: 'P' });
    expect(r.ok).toBe(false);
  });

  it('fetchParticipants pages through past_meetings, converts seconds to minutes and blanks to null', async () => {
    fake.config.maxPageSize = 2;
    await connectUserOAuth();
    const m = fake.seedMeeting({ start_time: inFuture(-1) });
    await expect(meetings.fetchParticipants(String(m.id))).rejects.toMatchObject({ name: 'ZoomError', status: 404 });

    fake.seedPastParticipants(m.id, [
      { name: 'A', user_email: 'a@x.co', duration: 3600 },
      { name: 'B', user_email: 'b@x.co', duration: 90 },
      { name: 'B', user_email: 'b@x.co', duration: 600 },
      { name: 'Guest', duration: 0 },
      { name: 'E', user_email: 'e@x.co', duration: 1800 },
    ]);
    fake.endMeeting(m.id);
    const rows = await meetings.fetchParticipants(String(m.id));
    expect(rows).toEqual([
      { name: 'A', email: 'a@x.co', durationMinutes: 60 },
      { name: 'B', email: 'b@x.co', durationMinutes: 1.5 },
      { name: 'B', email: 'b@x.co', durationMinutes: 10 },
      { name: 'Guest', email: null, durationMinutes: 0 },
      { name: 'E', email: 'e@x.co', durationMinutes: 30 },
    ]);
    expect(fake.state.requestLog.filter((e) => e.path.includes('/participants') && e.status === 200)).toHaveLength(3);
  });

  it('fetchParticipants retries a 429 in the middle of pagination', async () => {
    fake.config.maxPageSize = 2;
    await connectUserOAuth();
    const m = fake.seedMeeting();
    fake.seedPastParticipants(m.id, Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, user_email: `p${i}@x.co`, duration: 60 })));
    fake.endMeeting(m.id);
    fake.setFault({ match: `/past_meetings/${m.id}/participants`, status: 429, headers: { 'Retry-After': '1' }, times: 1 });
    expect(await meetings.fetchParticipants(String(m.id))).toHaveLength(4);
  });

  it('fetchConnectedUser (user token) returns the host email', async () => {
    const t = await connectUserOAuth();
    await expect(auth.fetchConnectedUser(t.access_token)).resolves.toEqual({ email: fake.config.hostEmail });
  });
});

// ═════════════════════════ webhooks ═════════════════════════

describe('fake Zoom webhook sender', () => {
  const SECRET = 'whsec_test_secret';
  let receiver: Server;
  let appUrl: string;
  interface Received {
    path: string;
    rawBody: string;
    signature: string | null;
    timestamp: string | null;
    verdict: ReturnType<typeof verifyZoomSignature>;
  }
  const received: Received[] = [];

  beforeAll(async () => {
    // A minimal stand-in for app/api/webhooks/zoom/route.ts: same verifier, same CRC answer.
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const signature = (req.headers['x-zm-signature'] as string | undefined) ?? null;
        const timestamp = (req.headers['x-zm-request-timestamp'] as string | undefined) ?? null;
        const verdict = verifyZoomSignature({ secret: SECRET, rawBody, signature, timestamp });
        received.push({ path: req.url ?? '', rawBody, signature, timestamp, verdict });
        if (!verdict.ok) {
          res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
          return;
        }
        let event: { event?: string; payload?: { plainToken?: string } };
        try {
          event = JSON.parse(rawBody) as typeof event;
        } catch {
          res.writeHead(400).end();
          return;
        }
        const out = event.event === 'endpoint.url_validation' && event.payload?.plainToken ? zoomCrcResponse(SECRET, event.payload.plainToken) : { ok: true };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
    appUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    receiver.closeAllConnections();
    await new Promise<void>((r) => receiver.close(() => r()));
  });
  beforeEach(() => {
    received.length = 0;
  });

  it('signs exactly like Zoom: v0=HMAC_SHA256(secret, "v0:<ts>:<rawBody>") and the app verifier accepts it', async () => {
    const event = { event: 'meeting.registration_created', event_ts: 1, payload: { object: { id: '123' } } };
    const res = await fake.sendWebhook(appUrl, SECRET, event);
    expect(res.status).toBe(200);
    const got = received[0];
    expect(got.path).toBe('/api/webhooks/zoom');
    expect(got.rawBody).toBe(JSON.stringify(event));
    expect(got.verdict).toEqual({ ok: true });
    const expected = `v0=${createHmac('sha256', SECRET).update(`v0:${got.timestamp}:${got.rawBody}`).digest('hex')}`;
    expect(got.signature).toBe(expected);
    expect(Math.abs(Number(got.timestamp) - Date.now() / 1000)).toBeLessThan(5);
  });

  it('a bad signature, wrong secret, stale / future timestamp and missing headers are all rejected', async () => {
    const ev = { event: 'meeting.ended' };
    expect((await fake.sendWebhook(appUrl, SECRET, ev, { badSignature: true })).status).toBe(401);
    expect(received.at(-1)?.verdict).toEqual({ ok: false, reason: 'bad-signature' });

    expect((await fake.sendWebhook(appUrl, 'other-secret', ev)).status).toBe(401);
    expect(received.at(-1)?.verdict).toEqual({ ok: false, reason: 'bad-signature' });

    expect((await fake.sendWebhook(appUrl, SECRET, ev, { timestampOffsetSec: -600 })).status).toBe(401);
    expect(received.at(-1)?.verdict).toEqual({ ok: false, reason: 'stale-timestamp' });
    expect((await fake.sendWebhook(appUrl, SECRET, ev, { timestampOffsetSec: 600 })).status).toBe(401);
    expect(received.at(-1)?.verdict).toEqual({ ok: false, reason: 'stale-timestamp' });

    expect((await fake.sendWebhook(appUrl, SECRET, ev, { omitHeaders: true })).status).toBe(401);
    expect(received.at(-1)?.verdict).toEqual({ ok: false, reason: 'missing-headers' });

    // inside the 5-minute tolerance is fine
    expect((await fake.sendWebhook(appUrl, SECRET, ev, { timestampOffsetSec: -200 })).status).toBe(200);
  });

  it('rawBody lets you send a validly-signed non-JSON payload', async () => {
    const res = await fake.sendWebhook(appUrl, SECRET, {}, { rawBody: '{not json' });
    expect(received[0].verdict).toEqual({ ok: true });
    expect(res.status).toBe(400);
  });

  it('sendCrc: endpoint.url_validation is answered with plainToken + HMAC(secret, plainToken)', async () => {
    const { response, plainToken, expectedEncryptedToken } = await fake.sendCrc(appUrl, SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plainToken, encryptedToken: expectedEncryptedToken });
    expect(expectedEncryptedToken).toBe(createHmac('sha256', SECRET).update(plainToken).digest('hex'));
  });

  it('event builders produce the real payload shapes (ids are strings, registrant nested)', async () => {
    fake.config.webinarAddOn = true;
    const m = fake.seedMeeting({ topic: 'Evt', approval_type: 0 });
    const reg = fake.seedRegistrant(m.id, { email: 'Reg@Ex.co', first_name: 'Reg', last_name: 'Ex' });
    const created = fake.registrationCreatedEvent(m.id, 'reg@ex.co') as { event: string; payload: { object: { id: string; registrant: { id: string; email: string; join_url: string } } } };
    expect(created.event).toBe('meeting.registration_created');
    expect(created.payload.object.id).toBe(String(m.id));
    expect(created.payload.object.registrant).toMatchObject({ id: reg.registrant_id, email: 'Reg@Ex.co', join_url: reg.join_url });

    const w = fake.seedMeeting({ kind: 'webinar' });
    const ended = fake.endMeeting(w.id) as { event: string; payload: { object: { id: string; end_time: string } } };
    expect(ended.event).toBe('webinar.ended');
    expect(typeof ended.payload.object.id).toBe('string');
    expect(Date.parse(ended.payload.object.end_time)).toBeGreaterThan(0);

    expect((await fake.sendWebhook(appUrl, SECRET, created)).status).toBe(200);
    expect(received[0].verdict).toEqual({ ok: true });
    expect(() => fake.registrationCreatedEvent(m.id, 'nobody@x.co')).toThrow();
  });
});
