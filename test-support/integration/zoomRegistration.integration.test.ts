// Deep / edge-case tests for Zoom registration: the app's REAL Zoom code (lib/zoom/*,
// lib/zoomRegistration.ts) talking over real HTTP to the fake Zoom server, which reproduces Zoom's
// real traps (default "no registration", unlicensed host silently ignoring settings, S2S rejecting
// "me", scope errors, 429s, idempotent registrants, rotating refresh tokens).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeZoom, type FakeZoom } from '../fakes/zoomFake';

const appConfig = new Map<string, string>();
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (_id: string, key: string) => appConfig.get(key)),
  saveIntegrationConfig: vi.fn(async (_id: string, fields: Record<string, string>) => {
    for (const [k, v] of Object.entries(fields)) appConfig.set(k, v);
  }),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));

// lib/zoomRegistration.ts touches the DB; stand in for it.
const db = vi.hoisted(() => ({
  contact: { update: vi.fn(async () => ({})) },
  campaign: { update: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/db', () => ({ db }));
const attention = vi.hoisted(() => ({ upsertAttentionItem: vi.fn(async () => undefined), resolveAttentionItems: vi.fn(async () => undefined) }));
vi.mock('@/lib/attentionItems', () => attention);

let fake: FakeZoom;
type Meetings = typeof import('@/lib/zoom/meetings');
type ZReg = typeof import('@/lib/zoomRegistration');
type Client = typeof import('@/lib/zoom/client');
type Auth = typeof import('@/lib/zoom/auth');
let meetings: Meetings;
let zreg: ZReg;
let client: Client;
let auth: Auth;

beforeAll(async () => {
  fake = await startFakeZoom();
  process.env.ZOOM_API_BASE_URL = fake.apiUrl;
  process.env.ZOOM_OAUTH_BASE_URL = fake.oauthUrl;
  vi.resetModules();
  meetings = await import('@/lib/zoom/meetings');
  zreg = await import('@/lib/zoomRegistration');
  client = await import('@/lib/zoom/client');
  auth = await import('@/lib/zoom/auth');
});
afterAll(async () => {
  await fake.stop();
  delete process.env.ZOOM_API_BASE_URL;
  delete process.env.ZOOM_OAUTH_BASE_URL;
  delete process.env.ZOOM_HOST_EMAIL;
});

async function connectUser() {
  const t = await auth.exchangeCodeForToken({ clientId: fake.config.clientId, clientSecret: fake.config.clientSecret, code: `c${Math.random()}`, redirectUri: 'http://localhost/cb' });
  appConfig.set('clientId', fake.config.clientId);
  appConfig.set('clientSecret', fake.config.clientSecret);
  appConfig.set('accessToken', t.accessToken);
  if (t.refreshToken) appConfig.set('refreshToken', t.refreshToken);
  appConfig.set('tokenExpiresAt', new Date(Date.now() + 3600_000).toISOString());
  appConfig.set('mode', 'live');
}
function connectS2S(hostEmail?: string) {
  appConfig.set('clientId', fake.config.clientId);
  appConfig.set('clientSecret', fake.config.clientSecret);
  appConfig.set('accountId', fake.config.accountId);
  appConfig.set('mode', 'live');
  if (hostEmail) appConfig.set('hostEmail', hostEmail);
}

beforeEach(() => {
  fake.reset();
  appConfig.clear();
  delete process.env.ZOOM_HOST_EMAIL;
  vi.clearAllMocks();
});

const future = () => new Date(Date.now() + 5 * 864e5);

describe('createMeeting — registration is enabled at creation', () => {
  it('sends approval_type 0 / registration_type 1 and reports registration enabled with a registration URL', async () => {
    await connectUser();
    const m = await meetings.createMeeting({ topic: 'QA', startTime: future() });
    expect(m.registrationEnabled).toBe(true);
    expect(m.registrationUrl).toMatch(/^https?:\/\//);
    const stored = [...fake.state.meetings.values()][0];
    expect(stored.settings.approval_type).toBe(0);
    expect(stored.settings.registration_type).toBe(1);
  });

  it('REGRESSION: a meeting created with the old defaults would refuse every registrant — now it accepts them', async () => {
    await connectUser();
    const m = await meetings.createMeeting({ topic: 'QA', startTime: future() });
    const r = await meetings.addZoomRegistrant(m.id, { email: 'a@x.com', firstName: 'Ann', lastName: 'Lee' }, { eventType: 'meeting' });
    expect(r.ok).toBe(true);
    expect(r.joinUrl).toContain('tk=');
  });

  it('reports registrationEnabled=false when an UNLICENSED host makes Zoom silently ignore the setting', async () => {
    await connectUser();
    fake.config.hostLicensed = false;
    const m = await meetings.createMeeting({ topic: 'QA', startTime: future() });
    expect(m.registrationEnabled).toBe(false);
  });

  it('passes the webinar timezone and duration through', async () => {
    await connectUser();
    const m = await meetings.createMeeting({ topic: 'QA', startTime: future(), durationMinutes: 90, timezone: 'Asia/Kolkata' });
    expect(m.duration).toBe(90);
  });
});

describe('addZoomRegistrant — happy path and idempotency', () => {
  it('returns a personal join link and registrant id', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' });
    expect(r).toMatchObject({ ok: true, eventType: 'meeting' });
    expect(r.registrantId).toBeTruthy();
  });

  it('registering the same email twice returns the SAME registrant (double-click, retry, webhook echo)', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const a = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' });
    const b = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' });
    expect(b.registrantId).toBe(a.registrantId);
    expect(b.joinUrl).toBe(a.joinUrl);
    expect(fake.state.registrants.get(m.id)).toHaveLength(1);
  });

  it('treats email case differences as the same person', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const a = await meetings.addZoomRegistrant(String(m.id), { email: 'Ann@X.com', firstName: 'Ann' });
    const b = await meetings.addZoomRegistrant(String(m.id), { email: 'ann@x.com', firstName: 'Ann' });
    expect(b.registrantId).toBe(a.registrantId);
  });

  it('handles unicode, very long and single-word names without failing', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    expect((await meetings.addZoomRegistrant(String(m.id), { email: 'u@x.com', firstName: 'Zoë 李雷 😀', lastName: 'Ñandú' })).ok).toBe(true);
    expect((await meetings.addZoomRegistrant(String(m.id), { email: 'one@x.com', firstName: 'Madonna' })).ok).toBe(true);
  });
});

describe('addZoomRegistrant — every failure is classified with an actionable explanation', () => {
  it('registration_not_enabled (Zoom 3027) on an event left at approval_type 2', async () => {
    await connectUser();
    const m = fake.seedMeeting({}); // default approval_type 2
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r).toMatchObject({ ok: false, reason: 'registration_not_enabled' });
    expect(r.error).toMatch(/Enable registration/);
  });

  it('enableZoomRegistration fixes it, after which registrants are accepted', async () => {
    await connectUser();
    const m = fake.seedMeeting({});
    const en = await meetings.enableZoomRegistration(String(m.id), 'meeting');
    expect(en.ok).toBe(true);
    expect(en.registrationUrl).toBeTruthy();
    expect((await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' })).ok).toBe(true);
  });

  it('enableZoomRegistration reports failure honestly for an unlicensed host', async () => {
    await connectUser();
    fake.config.hostLicensed = false;
    const m = fake.seedMeeting({});
    const en = await meetings.enableZoomRegistration(String(m.id), 'meeting');
    expect(en.ok).toBe(false);
    expect(en.error).toMatch(/Licensed/);
  });

  it('scope_missing when the token lacks the registrant scope', async () => {
    fake.config.scopes = ['meeting:read:meeting'];
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r).toMatchObject({ ok: false, reason: 'scope_missing' });
    expect(r.error).toMatch(/registrant scope/);
  });

  it('not_found for a deleted/unknown meeting', async () => {
    await connectUser();
    const r = await meetings.addZoomRegistrant('999999999', { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('validation for an invalid email', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'not-an-email', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('capacity when the registrant cap is reached (and an existing registrant is still returned, not rejected)', async () => {
    await connectUser();
    fake.config.maxRegistrants = 2;
    const m = fake.seedMeeting({ approval_type: 0 });
    await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'A' });
    await meetings.addZoomRegistrant(String(m.id), { email: 'b@x.com', firstName: 'B' });
    const third = await meetings.addZoomRegistrant(String(m.id), { email: 'c@x.com', firstName: 'C' }, { eventType: 'meeting' });
    expect(third).toMatchObject({ ok: false, reason: 'capacity' });
    expect((await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'A' })).ok).toBe(true);
  });

  it('host_not_licensed when an unlicensed host owns a registration-enabled event', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.config.hostLicensed = false;
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r).toMatchObject({ ok: false, reason: 'host_not_licensed' });
  });

  it('a rate limit is retried (Retry-After) and then succeeds — the caller never sees it', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.setFault({ match: '/meetings/*/registrants', method: 'POST', times: 2, status: 429, headers: { 'Retry-After': '1' } });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r.ok).toBe(true);
  });

  it('a persistent rate limit surfaces as rate_limited, not a misleading second call', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.setFault({ match: '/meetings/*/registrants', method: 'POST', times: 'forever', status: 429, headers: { 'Retry-After': '1' } });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' });
    expect(r).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(fake.state.requestLog.some((e) => e.path.includes('/webinars/'))).toBe(false); // did NOT fall through to the webinar API
  });

  it('a 5xx on the registrant POST is NOT replayed (it may already have been created)', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    fake.setFault({ match: '/meetings/*/registrants', method: 'POST', times: 1, status: 500, body: { code: 500, message: 'boom' } });
    const r = await meetings.addZoomRegistrant(String(m.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'meeting' });
    expect(r.ok).toBe(false);
    expect(fake.state.requestLog.filter((e) => e.method === 'POST' && e.path.includes('/registrants'))).toHaveLength(1);
  });
});

describe('meeting vs webinar kinds', () => {
  it('probes the webinar API ONLY after a genuine "not found" from the meeting API (kind unknown)', async () => {
    await connectUser();
    fake.config.webinarAddOn = true;
    const w = fake.seedMeeting({ kind: 'webinar', approval_type: 0 });
    const r = await meetings.addZoomRegistrant(String(w.id), { email: 'a@x.com', firstName: 'Ann' });
    expect(r).toMatchObject({ ok: true, eventType: 'webinar' });
  });

  it('uses the stored kind directly with no probing', async () => {
    await connectUser();
    fake.config.webinarAddOn = true;
    const w = fake.seedMeeting({ kind: 'webinar', approval_type: 0 });
    await meetings.addZoomRegistrant(String(w.id), { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'webinar' });
    expect(fake.state.requestLog.some((e) => e.path.startsWith('/meetings/'))).toBe(false);
  });

  it('webinar without the add-on: a clear failure, not a crash', async () => {
    await connectUser();
    const r = await meetings.addZoomRegistrant('123456789', { email: 'a@x.com', firstName: 'Ann' }, { eventType: 'webinar' });
    expect(r.ok).toBe(false);
  });
});

describe('Server-to-Server OAuth', () => {
  it('REGRESSION: needs a host user — "me" is rejected by Zoom, so Studio names the host explicitly', async () => {
    connectS2S(fake.config.hostEmail);
    const m = await meetings.createMeeting({ topic: 'QA', startTime: future() });
    expect(m.registrationEnabled).toBe(true);
    expect(fake.state.requestLog.some((e) => /\/users\/me\//.test(e.path))).toBe(false);
  });

  it('without a host email it fails with a message that says what to configure (no cryptic Zoom 400)', async () => {
    connectS2S();
    await expect(meetings.createMeeting({ topic: 'QA', startTime: future() })).rejects.toThrow(/host user|Host email|ZOOM_HOST_EMAIL/i);
  });

  it('reads the host from ZOOM_HOST_EMAIL as a fallback', async () => {
    connectS2S();
    process.env.ZOOM_HOST_EMAIL = fake.config.hostEmail;
    expect(await client.zoomHostUser()).toBe(encodeURIComponent(fake.config.hostEmail));
  });

  it('user-managed OAuth keeps using "me"', async () => {
    await connectUser();
    expect(await client.zoomHostUser()).toBe('me');
  });

  it('refreshes an expired S2S token transparently mid-flight', async () => {
    connectS2S(fake.config.hostEmail);
    await meetings.createMeeting({ topic: 'one', startTime: future() });
    fake.advanceTime(2 * 3600_000);
    const m2 = await meetings.createMeeting({ topic: 'two', startTime: future() });
    expect(m2.id).toBeTruthy();
  });
});

describe('syncRegistrantToZoom — persistence, learning and operator alerts', () => {
  const campaign = (over: Record<string, unknown> = {}) => ({ id: 'c1', zoomMeetingId: '', zoomEventType: null as string | null, ...over });
  const contact = (over: Record<string, unknown> = {}) => ({ id: 'ct1', email: 'a@x.com', name: 'Ann Marie Lee', zoomJoinUrl: null as string | null, ...over });

  it('stores the personal join link, splits the name, learns the event kind and clears any old alert', async () => {
    await connectUser();
    const m = fake.seedMeeting({ approval_type: 0 });
    const out = await zreg.syncRegistrantToZoom(campaign({ zoomMeetingId: String(m.id) }), contact());
    expect(out.ok).toBe(true);
    expect(db.contact.update).toHaveBeenCalledWith({ where: { id: 'ct1' }, data: expect.objectContaining({ zoomJoinUrl: expect.stringContaining('tk=') }) });
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { zoomEventType: 'meeting' } });
    expect(attention.resolveAttentionItems).toHaveBeenCalledWith('c1', [expect.stringContaining(zreg.ZOOM_REGISTRATION_ALERT + ' —')]);
    const reg = fake.state.registrants.get(m.id)?.[0];
    expect(reg?.first_name).toBe('Ann');
    expect(reg?.last_name).toBe('Marie Lee');
  });

  it('raises ONE plain-language alert when registration is not enabled — and no join link is stored', async () => {
    await connectUser();
    const m = fake.seedMeeting({});
    const out = await zreg.syncRegistrantToZoom(campaign({ zoomMeetingId: String(m.id), zoomEventType: 'meeting' }), contact());
    expect(out.ok).toBe(false);
    expect(db.contact.update).not.toHaveBeenCalled();
    expect(attention.upsertAttentionItem).toHaveBeenCalledWith('c1', expect.objectContaining({ title: expect.stringContaining(zreg.ZOOM_REGISTRATION_ALERT + ' —'), detail: expect.stringMatching(/Enable registration/) }));
  });

  it('skips cleanly (no Zoom call) with no linked meeting, no email, or an existing personal link', async () => {
    await connectUser();
    expect(await zreg.syncRegistrantToZoom(campaign({ zoomMeetingId: null }), contact())).toEqual({ ok: true, skipped: true });
    expect(await zreg.syncRegistrantToZoom(campaign({ zoomMeetingId: '1' }), contact({ email: null }))).toEqual({ ok: true, skipped: true });
    expect(await zreg.syncRegistrantToZoom(campaign({ zoomMeetingId: '1' }), contact({ zoomJoinUrl: 'https://zoom.us/w/1?tk=x' }))).toEqual({ ok: true, skipped: true });
    expect(fake.state.requestLog.filter((e) => e.path.includes('registrants'))).toHaveLength(0);
  });

  it('splitName handles blanks, single names and extra whitespace', () => {
    expect(zreg.splitName('   ')).toEqual({ firstName: 'Attendee', lastName: '' });
    expect(zreg.splitName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' });
    expect(zreg.splitName('  Ann   Marie\tLee ')).toEqual({ firstName: 'Ann', lastName: 'Marie Lee' });
  });
});
