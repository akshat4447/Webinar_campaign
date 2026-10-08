// End-to-end check of the "my own landing page" flow, against the fake Zoom and LeadSquared servers
// (nothing real is contacted) and a throwaway campaign in the local database:
//   invite link per channel -> (landing page + snippet) -> POST /api/landing/submit
//   -> contact registered with the right channel -> Zoom registrant -> LSQ activity + suppression list
//   -> pending outreach cancelled.
// The snippet's own parameter handling is reproduced here (source || utm_source, token, campaignId) because
// there is no DOM in this test environment.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { startFakeZoom, type FakeZoom } from '../fakes/zoomFake';
import { startFakeLsq, type FakeLsq } from '../fakes/lsqFake';

const cfg: Record<string, Map<string, string>> = { zoom: new Map(), lsq: new Map() };
vi.mock('@/lib/integrationConfig', () => ({
  resolveIntegrationField: vi.fn(async (id: string, key: string) => cfg[id]?.get(key)),
  saveIntegrationConfig: vi.fn(async (id: string, fields: Record<string, string>) => {
    for (const [k, v] of Object.entries(fields)) cfg[id]?.set(k, v);
  }),
}));
vi.mock('@/lib/retry', async (orig) => ({ ...(await orig<typeof import('@/lib/retry')>()), sleep: vi.fn(async () => undefined) }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ allowRequest: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })), clientIp: () => '127.0.0.1' }));

let zoom: FakeZoom;
let lsq: FakeLsq;
let campaignId = '';
let meetingId = '';
let suppressionListId = '';
const ORIGIN = 'https://studio.example.com';
const LANDING = 'https://lp.example.com/webinar';
const created: { contacts: string[] } = { contacts: [] };

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let submit: typeof import('@/app/api/landing/submit/route')['POST'];
let shortLink: typeof import('@/app/(public)/r/[token]/route')['GET'];
let buildInviteLink: typeof import('@/lib/inviteLink')['buildInviteLink'];
let resolveChannel: typeof import('@/lib/registrationChannels')['resolveContactRegistrationChannel'];
let generateSnippet: typeof import('@/lib/landingPage')['generateUniversalEmbedScript'];

beforeAll(async () => {
  zoom = await startFakeZoom();
  lsq = await startFakeLsq({ accessKey: 'AK', secretKey: 'SK' });
  process.env.ZOOM_API_BASE_URL = zoom.apiUrl;
  process.env.ZOOM_OAUTH_BASE_URL = zoom.oauthUrl;
  process.env.LSQ_API_BASE_URL = lsq.url;
  cfg.zoom.set('clientId', zoom.config.clientId);
  cfg.zoom.set('clientSecret', zoom.config.clientSecret);
  cfg.zoom.set('accountId', zoom.config.accountId);
  cfg.zoom.set('hostEmail', 'host@example.com');
  cfg.zoom.set('mode', 'live');
  for (const [k, v] of Object.entries({ accessKey: 'AK', secretKey: 'SK', host: 'x', senderEmail: 'sender@example.com' })) cfg.lsq.set(k, v);

  vi.resetModules();
  db = (await import('@/lib/db')).db;
  submit = (await import('@/app/api/landing/submit/route')).POST;
  shortLink = (await import('@/app/(public)/r/[token]/route')).GET;
  buildInviteLink = (await import('@/lib/inviteLink')).buildInviteLink;
  resolveChannel = (await import('@/lib/registrationChannels')).resolveContactRegistrationChannel;
  generateSnippet = (await import('@/lib/landingPage')).generateUniversalEmbedScript;
  const { provisionCampaignDefaults } = await import('@/lib/campaignDefaults');

  const meeting = zoom.seedMeeting({ approval_type: 0 });
  meetingId = String(meeting.id);
  const list = await (await import('@/lib/leadsquared')).createEmptyList('Landing flow suppression', 'test');
  suppressionListId = String((list as { ListId?: string; Id?: string }).ListId ?? (list as { Id?: string }).Id ?? list);

  const campaign = await db.campaign.create({
    data: {
      name: 'ZZ Landing Flow Test', vertical: 'Test', date: 'x',
      scheduledAt: new Date(Date.now() + 7 * 864e5), status: 'live', cadenceStatus: 'running',
      registrationMode: 'external', registrationLink: LANDING, oneClickSignup: false, landingPrefill: false,
      zoomMeetingId: meetingId, zoomEventType: 'meeting', zoomLink: `https://zoom.example/j/${meetingId}`,
      lsqSuppressionListId: suppressionListId, stopOnRegistration: true,
    },
  });
  campaignId = campaign.id;
  await provisionCampaignDefaults(campaignId);
}, 60_000);

afterAll(async () => {
  if (campaignId) await db.campaign.delete({ where: { id: campaignId } }).catch(() => undefined); // cascades contacts/sends/steps
  await zoom?.stop();
  await lsq?.stop();
  delete process.env.ZOOM_API_BASE_URL;
  delete process.env.ZOOM_OAUTH_BASE_URL;
  delete process.env.LSQ_API_BASE_URL;
});

async function makeInvitee(email: string, name: string) {
  const c = await db.contact.create({ data: { campaignId, name, email, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true, score: 80 } });
  created.contacts.push(c.id);
  // a still-pending follow-up nudge, which registration must cancel
  await db.cadenceSend.create({ data: { campaignId, contactId: c.id, stepKey: 'nudge', dueAt: new Date(Date.now() + 864e5), status: 'queued' } });
  return c;
}

/** What the landing page's snippet reads from the address bar. */
function snippetParams(url: string) {
  const p = new URL(url).searchParams;
  return { campaignId: p.get('campaignId') ?? '', token: p.get('token') ?? '', source: p.get('source') || p.get('utm_source') || 'website' };
}

async function postSubmit(body: Record<string, unknown>) {
  const req = new NextRequest('https://studio.example.com/api/landing/submit', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const res = await submit(req);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function landingUrlFor(contactId: string, channel: string): Promise<string> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const link = buildInviteLink({ campaign, contact, channel, appOrigin: ORIGIN });
  if (new URL(link).origin !== ORIGIN) return link; // already the landing page
  // Short /r/<token> link: follow the redirect the route issues.
  const u = new URL(link);
  const res = await shortLink(new Request(link), { params: Promise.resolve({ token: u.pathname.split('/r/')[1] }) } as never);
  return res.headers.get('location') as string;
}

describe('the invite link carries the channel to the landing page', () => {
  it.each(['email', 'whatsapp', 'linkedin', 'sms'])('%s: the landing URL is the operator\'s page with source + utm_source + campaign id + token', async (channel) => {
    const c = await makeInvitee(`${channel}@x.com`, `Invitee ${channel}`);
    const url = await landingUrlFor(c.id, channel);
    expect(url.startsWith(LANDING)).toBe(true);
    const p = snippetParams(url);
    expect(p.campaignId).toBe(campaignId);
    expect(p.source).toBe(channel);
    expect(p.token).not.toBe('');
  });

  it('LinkedIn and SMS links stay short enough for their limits', async () => {
    const c = await makeInvitee('short@x.com', 'Short Link');
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    for (const channel of ['linkedin', 'sms']) {
      expect(buildInviteLink({ campaign, contact: c, channel, appOrigin: ORIGIN }).length).toBeLessThan(160);
    }
  });
});

describe('submitting the landing page form (what the snippet sends)', () => {
  it('registers the invited contact under the channel they came from, cancels pending outreach, syncs Zoom and LeadSquared', async () => {
    const c = await makeInvitee('flow-email@x.com', 'Flow Email');
    const p = snippetParams(await landingUrlFor(c.id, 'email'));
    const { status, json } = await postSubmit({ campaignId: p.campaignId, token: p.token, email: c.email, firstName: 'Flow', lastName: 'Email', source: p.source });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.registeredAt).not.toBeNull();
    expect(after.registrationSource).toBe('email');
    expect(resolveChannel(after, new Map())).toBe('email_campaign');

    // pending nudge cancelled
    const nudge = await db.cadenceSend.findFirstOrThrow({ where: { campaignId, contactId: c.id, stepKey: 'nudge' } });
    expect(nudge.status).toBe('skipped');

    // background work: Zoom registrant, LeadSquared activity + suppression list
    await (await import('@/lib/registrationJobs')).processRegistrationJobs({ contactId: c.id });
    await vi.waitFor(async () => {
      const regs = zoom.state.registrants.get(Number(meetingId)) ?? [];
      expect(regs.some((r) => r.email === 'flow-email@x.com')).toBe(true);
      const z = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
      expect(z.zoomJoinUrl).toBeTruthy();
    }, { timeout: 30_000, interval: 250 });
    await (await import('@/lib/registrationJobs')).processRegistrationJobs({ contactId: c.id });
    await vi.waitFor(async () => {
      const list = [...lsq.state.lists.values()].find((l) => l.id === suppressionListId);
      const lead = (await db.contact.findUniqueOrThrow({ where: { id: c.id } })).lsqLeadId;
      expect(lead).toBeTruthy();
      expect(list?.members).toContain(lead);
    }, { timeout: 30_000, interval: 250 });
    expect(lsq.state.activities.length).toBeGreaterThan(0);
  }, 70_000);

  it.each([
    ['whatsapp', 'whatsapp'],
    ['linkedin', 'linkedin'],
    ['sms', 'sms'],
  ])('%s link -> channel "%s" in the analytics', async (channel, expected) => {
    const c = await makeInvitee(`flow-${channel}@x.com`, `Flow ${channel}`);
    const p = snippetParams(await landingUrlFor(c.id, channel));
    const { json } = await postSubmit({ campaignId: p.campaignId, token: p.token, email: c.email, source: p.source });
    expect(json.ok).toBe(true);
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(resolveChannel(after, new Map())).toBe(expected);
  }, 70_000);

  it('a stranger arriving from a public channel link (no token) is created and attributed to that channel', async () => {
    const { json } = await postSubmit({ campaignId, email: 'stranger@x.com', firstName: 'Stan', source: 'third_parties' });
    expect(json.ok).toBe(true);
    const c = await db.contact.findFirstOrThrow({ where: { campaignId, email: 'stranger@x.com' } });
    created.contacts.push(c.id);
    expect(resolveChannel(c, new Map())).toBe('third_parties');
    // what this inbound registrant looks like to the rest of the tool
    expect({ approved: c.approved, score: c.score }).toEqual({ approved: false, score: null });
  }, 70_000);

  it('submitting twice does not duplicate (idempotent)', async () => {
    const c = await makeInvitee('twice@x.com', 'Twice');
    const p = snippetParams(await landingUrlFor(c.id, 'email'));
    const a = await postSubmit({ campaignId, token: p.token, email: c.email, source: p.source });
    const b = await postSubmit({ campaignId, token: p.token, email: c.email, source: p.source });
    expect(a.json.alreadyRegistered).toBe(false);
    expect(b.json.alreadyRegistered).toBe(true);
  }, 70_000);

  it('a page visited without any channel parameters is recorded as "website", not lost', async () => {
    const { json } = await postSubmit({ campaignId, email: 'direct@x.com', source: snippetParams(LANDING).source });
    expect(json.ok).toBe(true);
    const c = await db.contact.findFirstOrThrow({ where: { campaignId, email: 'direct@x.com' } });
    expect(resolveChannel(c, new Map())).toBe('website');
  }, 70_000);

  it('refuses new registrations once the webinar has ended', async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: new Date(Date.now() - 3 * 864e5) } });
    const { status, json } = await postSubmit({ campaignId, email: 'late@x.com', source: 'email' });
    await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: new Date(Date.now() + 7 * 864e5) } });
    expect(status).toBe(409);
    expect(json.reason).toBeTruthy();
  }, 70_000);
});

describe('the snippet itself', () => {
  const script = () => generateSnippet({ apiOrigin: ORIGIN, campaignId: 'camp1', zoomId: meetingId });
  it('posts to this app, never to an address taken from the page URL', () => {
    expect(script()).toContain(JSON.stringify(ORIGIN));
    expect(script()).not.toMatch(/params\.get\('apiOrigin'\)/);
  });
  it('reads the channel from source, then utm_source', () => {
    expect(script()).toContain("source: params.get('source') || params.get('utm_source') || ''");
    expect(script()).toContain("|| 'website'");
  });
});
