import { it, expect, vi, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
import { startFakeZoom } from '../fakes/zoomFake';

// A user-managed Zoom app: its access token lasts an hour and is renewed with a refresh token that Zoom rotates.
// Covers Test Connection, real calls with an expired token, and the connect route's redirect check.
const fake = await startFakeZoom({ webinarAddOn: true });
process.env.ZOOM_OAUTH_BASE_URL = fake.oauthUrl;
process.env.ZOOM_API_BASE_URL = fake.apiUrl;
const { db } = await import('@/lib/db');
const { saveIntegrationConfig, resolveIntegrationField } = await import('@/lib/integrationConfig');
const { testIntegrationAction } = await import('@/lib/actions/integrations');
const { listZoomMeetingsAction } = await import('@/lib/actions/zoom');
const { GET: connect } = await import('@/app/api/auth/zoom/connect/route');

const basic = () => `Basic ${Buffer.from(`${fake.config.clientId}:${fake.config.clientSecret}`).toString('base64')}`;
async function authorize() {
  const res = await fetch(`${fake.oauthUrl}/oauth/token`, { method: 'POST', headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: 'abc', redirect_uri: 'http://localhost:3000/api/auth/zoom/callback' }) });
  return (await res.json()) as { access_token: string; refresh_token: string };
}
const clearZoom = () => db.appSetting.deleteMany({ where: { key: { startsWith: 'integration.zoom.' } } });
const connectWith = async (tokens: { access_token: string; refresh_token: string }, expiredAgoMs: number) =>
  saveIntegrationConfig('zoom', {
    clientId: fake.config.clientId, clientSecret: fake.config.clientSecret, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(Date.now() - expiredAgoMs).toISOString(),
  });

beforeEach(async () => {
  fake.reset();
  await clearZoom();
});
afterAll(async () => {
  await clearZoom();
  await db.$disconnect();
  await fake.stop();
});

it('Test Connection renews an expired access token with the saved refresh token instead of reporting it as expired', async () => {
  const t = await authorize();
  await connectWith(t, 15 * 24 * 3600 * 1000); // expired two weeks ago, as in the field
  fake.expireAllTokens(); // and Zoom itself answers 401 "Access token is expired" for it
  const r = await testIntegrationAction('zoom');
  expect(r.ok).toBe(true);
  expect(r.detail).toMatch(/connected as/);
  expect(r.detail).toMatch(/renewed automatically/);
  expect(await resolveIntegrationField('zoom', 'accessToken')).not.toBe(t.access_token);
  expect(await resolveIntegrationField('zoom', 'refreshToken')).not.toBe(t.refresh_token); // Zoom rotated it and it was kept
  expect(await resolveIntegrationField('zoom', 'connectedEmail')).toBe(fake.config.hostEmail);
});

it('Test Connection also copes when the recorded expiry is still in the future but Zoom has already refused the token', async () => {
  const t = await authorize();
  await connectWith(t, -3600 * 1000);
  fake.expireAllTokens();
  const r = await testIntegrationAction('zoom');
  expect(r.ok).toBe(true);
  expect(r.detail).toMatch(/renewed automatically/);
});

it('Test Connection says why when Zoom no longer accepts the saved connection, and what to do', async () => {
  const t = await authorize();
  await connectWith({ access_token: t.access_token, refresh_token: 'revoked-or-replaced' }, 24 * 3600 * 1000);
  fake.expireAllTokens();
  const r = await testIntegrationAction('zoom');
  expect(r.ok).toBe(false);
  expect(r.detail).toMatch(/no longer accepts the saved connection/);
  expect(r.detail).toMatch(/Connect With Zoom/);
  expect(r.detail).not.toMatch(/Access token is expired/);
});

it('Test Connection reports wrong app credentials as such', async () => {
  const t = await authorize();
  await connectWith(t, 24 * 3600 * 1000);
  await saveIntegrationConfig('zoom', { clientSecret: 'regenerated-so-this-is-stale' });
  const r = await testIntegrationAction('zoom');
  expect(r.ok).toBe(false);
  expect(r.detail).toMatch(/Client ID or Client Secret/);
});

it.each([86400000, -3600000])('ordinary Zoom calls preserve the reconnect reason for a revoked refresh token (expiry offset %s)', async expiry => {
  const t = await authorize();
  await connectWith({ access_token: t.access_token, refresh_token: 'revoked-or-replaced' }, expiry);
  fake.expireAllTokens();
  const result = await listZoomMeetingsAction();
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toMatch(/Connect With Zoom/);
    expect(result.error).toMatch(/no longer accepts the saved connection/);
    expect(result.error).not.toMatch(/Access token is expired/);
  }
});

it('real calls (listing events) renew the token the same way', async () => {
  fake.seedMeeting({ kind: 'meeting', topic: 'Renewed List', start_time: new Date(Date.now() + 864e5).toISOString() });
  const t = await authorize();
  await connectWith(t, 15 * 24 * 3600 * 1000);
  fake.expireAllTokens();
  const r = await listZoomMeetingsAction();
  expect(r.ok && r.meetings.map((m) => m.topic)).toEqual(['Renewed List']);
});

it('Connect refuses a saved Redirect URI that is a closed tunnel, and explains how to fix it', async () => {
  await saveIntegrationConfig('zoom', { clientId: fake.config.clientId, clientSecret: fake.config.clientSecret, redirectUri: 'https://closed-tunnel-example.trycloudflare.com/api/auth/zoom/callback' });
  const res = await connect(new Request('http://localhost:3000/api/auth/zoom/connect'));
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get('location')!);
  expect(to.pathname).toBe('/integrations');
  expect(to.searchParams.get('connected')).toBe('error');
  const detail = to.searchParams.get('detail')!;
  expect(detail).toMatch(/does not answer/);
  expect(detail).toContain('http://localhost:3000/api/auth/zoom/callback');
  expect(await db.appSetting.count({ where: { key: { startsWith: 'zoom.oauth_state.' } } })).toBe(0); // nothing was started
});

it('Connect uses this server\'s address when no Redirect URI is saved, and an address that answers when one is', async () => {
  await saveIntegrationConfig('zoom', { clientId: fake.config.clientId, clientSecret: fake.config.clientSecret });
  const plain = await connect(new Request('http://localhost:3000/api/auth/zoom/connect'));
  const target = new URL(plain.headers.get('location')!);
  expect(target.origin).toBe(new URL(fake.oauthUrl).origin);
  expect(target.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/zoom/callback');

  const live = http.createServer((req, res) => { res.writeHead(req.url === '/api/health' ? 200 : 404); res.end('{}'); });
  await new Promise<void>((r) => live.listen(0, '127.0.0.1', r));
  const liveOrigin = `http://127.0.0.1:${(live.address() as import('node:net').AddressInfo).port}`;
  try {
    await saveIntegrationConfig('zoom', { redirectUri: `${liveOrigin}/api/auth/zoom/callback` });
    // Zoom returns people to that address, so the connection first moves there (sign-in and the security check live on it)...
    const hop = await connect(new Request('http://localhost:3000/api/auth/zoom/connect?returnTo=%2Fcampaigns%2Fnew'));
    const hopTo = new URL(hop.headers.get('location')!);
    expect(hopTo.origin).toBe(liveOrigin);
    expect(hopTo.pathname).toBe('/api/auth/zoom/connect');
    expect(hopTo.searchParams.get('hop')).toBe('1');
    expect(hopTo.searchParams.get('returnTo')).toBe('/campaigns/new');
    // ...and from there it goes on to Zoom with that address as the return address.
    const viaLive = await connect(new Request(`${liveOrigin}/api/auth/zoom/connect?hop=1`));
    expect(new URL(viaLive.headers.get('location')!).searchParams.get('redirect_uri')).toBe(`${liveOrigin}/api/auth/zoom/callback`);
  } finally {
    live.close();
  }
});
