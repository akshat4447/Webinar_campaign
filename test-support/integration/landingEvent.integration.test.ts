// The public endpoint behind the landing page's calendar pop-up, against a throwaway campaign in the local database.
// It must say only what the public page already says, and add the personal join link only for a real registration.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rateLimit', () => ({ allowRequest: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })), clientIp: () => '127.0.0.1' }));

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let GET: typeof import('@/app/api/landing/event/route')['GET'];
let OPTIONS: typeof import('@/app/api/landing/event/route')['OPTIONS'];
let mint: typeof import('@/lib/registration')['mintRegistrationToken'];
let allow: typeof import('@/lib/rateLimit')['allowRequest'];

const GENERIC_ZOOM = 'https://zoom.example/j/generic-room';
const PERSONAL_JOIN = 'https://zoom.example/w/personal-join-abc';
const campaigns: string[] = [];

async function campaign(extra: Record<string, unknown> = {}) {
  const c = await db.campaign.create({
    data: {
      name: 'ZZ Event Endpoint Webinar', vertical: 'Test', date: 'x', description: 'What you will learn',
      scheduledAt: new Date(Date.now() + 5 * 864e5), durationMinutes: 45, status: 'live', zoomLink: GENERIC_ZOOM, zoomMeetingId: '123456789',
      ...extra,
    },
  });
  campaigns.push(c.id);
  return c;
}
async function contact(campaignId: string, extra: Record<string, unknown> = {}) {
  return db.contact.create({ data: { campaignId, name: 'Priya Nair', email: `p${Math.random().toString(36).slice(2)}@example.com`, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true, score: 80, ...extra } });
}
const get = (query: string) => GET(new NextRequest(`https://studio.example.com/api/landing/event?${query}`));

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  ({ GET, OPTIONS } = await import('@/app/api/landing/event/route'));
  mint = (await import('@/lib/registration')).mintRegistrationToken;
  allow = (await import('@/lib/rateLimit')).allowRequest;
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: campaigns } } });
  await db.$disconnect();
});

describe('GET /api/landing/event', () => {
  it('gives anyone the webinar name, time and ready-made calendar links, and keeps the join link private', async () => {
    const c = await campaign();
    const res = await get(`c=${c.id}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(body.ok).toBe(true);
    expect(body.event).toMatchObject({ title: 'ZZ Event Endpoint Webinar', personal: false });
    expect(new Date(body.event.end).getTime() - new Date(body.event.start).getTime()).toBe(45 * 60_000);
    expect(body.calendar.google).toContain('calendar.google.com');
    expect(body.calendar.outlookLive).toContain('outlook.live.com');
    expect(body.calendar.outlookOffice).toContain('outlook.office.com');
    expect(body.calendar.ics).toContain('BEGIN:VCALENDAR');
    expect(body.calendar.ics).toContain('Joining details will be sent to you by email');
    expect(JSON.stringify(body)).not.toContain('generic-room');
  });

  it('adds the personal join link, and no more, for a valid registration token', async () => {
    const c = await campaign();
    const person = await contact(c.id, { registeredAt: new Date(), zoomJoinUrl: PERSONAL_JOIN });
    const res = await get(`c=${c.id}&t=${encodeURIComponent(mint(c.id, person.id))}`);
    const body = await res.json();
    expect(body.event.personal).toBe(true);
    expect(body.calendar.ics).toContain('personal-join-abc');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('treats a token for someone who has not registered, or for another webinar, as no token at all', async () => {
    const c = await campaign();
    const other = await campaign();
    const notRegistered = await contact(c.id, { zoomJoinUrl: PERSONAL_JOIN });
    const registeredElsewhere = await contact(other.id, { registeredAt: new Date(), zoomJoinUrl: PERSONAL_JOIN });
    for (const token of [mint(c.id, notRegistered.id), mint(other.id, registeredElsewhere.id), 'not-a-token']) {
      const body = await (await get(`c=${c.id}&t=${encodeURIComponent(token)}`)).json();
      expect(body.event.personal).toBe(false);
      expect(JSON.stringify(body)).not.toContain('personal-join-abc');
    }
  });

  it('answers a missing, malformed, unknown or archived webinar without leaking anything', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('c=../../etc')).status).toBe(400);
    expect((await get('c=doesnotexist1234')).status).toBe(404);
    const archived = await campaign({ archived: true });
    expect((await get(`c=${archived.id}`)).status).toBe(404);
  });

  it('says there is no event, rather than failing, for a webinar with no time yet', async () => {
    const c = await campaign({ scheduledAt: null, date: 'Not scheduled yet' });
    const body = await (await get(`c=${c.id}`)).json();
    expect(body).toMatchObject({ ok: true, event: null });
  });

  it('is limited per address, and answers the browser’s preflight', async () => {
    const c = await campaign();
    vi.mocked(allow).mockResolvedValueOnce({ allowed: false, retryAfterSec: 7 });
    const limited = await get(`c=${c.id}`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    const preflight = await OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
  });
});

describe('the moment between registering and the joining link existing', () => {
  const PENDING = 'Joining details will be sent to you by email';
  async function registeredWithoutLink() {
    const c = await campaign({ description: 'This is regarding the use of AI in the current entrepreneurial era' });
    const person = await contact(c.id, { registeredAt: new Date(), zoomJoinUrl: null });
    const token = mint(c.id, person.id);
    return { c, person, token };
  }
  const detailsOf = (googleUrl: string) => new URL(googleUrl).searchParams.get('details') ?? '';

  it('says "Join URL: Joining details will be sent to you by email" in every calendar until the link is made, and never caches it', async () => {
    const { c, token } = await registeredWithoutLink();
    const res = await get(`c=${c.id}&t=${encodeURIComponent(token)}`);
    const body = await res.json();
    expect(body.event.personal).toBe(false);
    expect(detailsOf(body.calendar.google)).toContain(`Join URL: ${PENDING}`);
    expect(new URL(body.calendar.google).searchParams.get('location')).toBe(PENDING);
    expect(new URL(body.calendar.outlookOffice).searchParams.get('body')).toContain(`Join URL: ${PENDING}`);
    expect(body.calendar.ics).toContain(`Join URL: ${PENDING}`);
    // built for one registered person and about to change: never stored by a browser or a CDN
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('carries the real link the next time it is asked, once Zoom has issued it', async () => {
    const { c, person, token } = await registeredWithoutLink();
    const before = await (await get(`c=${c.id}&t=${encodeURIComponent(token)}`)).json();
    expect(before.event.personal).toBe(false);

    await db.contact.update({ where: { id: person.id }, data: { zoomJoinUrl: PERSONAL_JOIN } });
    const after = await (await get(`c=${c.id}&t=${encodeURIComponent(token)}`)).json();
    expect(after.event.personal).toBe(true);
    expect(detailsOf(after.calendar.google)).toContain(`Join URL: ${PERSONAL_JOIN}`);
    expect(detailsOf(after.calendar.google)).not.toContain(PENDING);
    expect(after.calendar.ics).toContain(PERSONAL_JOIN);
  });

  it('keeps the anonymous answer cacheable, since it is the same for everyone', async () => {
    const c = await campaign();
    const res = await get(`c=${c.id}`);
    expect(res.headers.get('cache-control')).toContain('public');
  });

  it('says the same thing in the calendar file downloaded from the attendee page', async () => {
    const { GET: calendarFile } = await import('@/app/api/calendar/[campaignId]/route');
    const { c, token } = await registeredWithoutLink();
    const res = await calendarFile(new Request(`https://studio.example.com/api/calendar/${c.id}?t=${encodeURIComponent(token)}`), { params: Promise.resolve({ campaignId: c.id }) } as never);
    const ics = await res.text();
    expect(res.status).toBe(200);
    expect(ics).toContain(`Join URL: ${PENDING}`);
    expect(ics).not.toMatch(/provided by the organizer/);
  });
});
