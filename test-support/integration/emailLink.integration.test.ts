// Which address an invite email shows, end to end: invites are queued and sent through the real send path against a real
// database, with only the mail provider replaced, and the body that would have gone out is read back. A landing page on a
// free builder address must not decide the link when Studio has a better address to show, and nothing may ever carry a
// temporary tunnel or local address that Studio itself has.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/sendWindow', () => ({ isWithinSendWindow: () => true }));
vi.mock('@/lib/integrationConfig', () => ({ resolveIntegrationField: vi.fn(async () => undefined) }));
vi.mock('@/lib/netcore', async (original) => ({ ...(await original<typeof import('@/lib/netcore')>()), sendNetcoreEmail: vi.fn(async () => ({ ok: true, messageId: 'receipt-1' })) }));
vi.mock('@/lib/messageTemplates', async (original) => ({
  ...(await original<typeof import('@/lib/messageTemplates')>()),
  resolveStepTemplate: vi.fn(async () => ({ id: 'template-1', label: 'Invite', channel: 'email', subject: 'Join {{topic}}', body: 'Hello {{firstName}}, save your seat: {{link}}', hidden: false })),
}));

import { db } from '@/lib/db';
import { processDueSends } from '@/lib/cadence';
import { sendNetcoreEmail } from '@/lib/netcore';
import { resolveStepTemplate } from '@/lib/messageTemplates';
import { verifyRegistrationToken } from '@/lib/registration';
import { GET as shortLink } from '@/app/(public)/r/[token]/route';
import { POST as landingSubmit } from '@/app/api/landing/submit/route';
import { NextRequest } from 'next/server';

const FREE_PAGE = 'https://my-landing-page.framer.app/';
const OWN_PAGE = 'https://webinar.leadsquared.com/ai';
const STUDIO = 'https://studio.leadsquared.com';
const TUNNEL = 'https://old-tunnel-name.trycloudflare.com';

const ids: string[] = [];
const originalOrigin = process.env.APP_ORIGIN;

async function sentBody(opts: { landing: string; studio: string; registered?: boolean; body?: string }): Promise<{ text: string; html: string; contactId: string; campaignId: string }> {
  process.env.APP_ORIGIN = opts.studio;
  const c = await db.campaign.create({
    data: {
      name: 'ZZ Email Link', vertical: 'Test', date: 'Future', scheduledAt: new Date(Date.now() + 7 * 864e5), cadenceStatus: 'running', status: 'live',
      scheduleWindow: '00:00-23:59', msgMode: 'templatized', dailyLimit: 100, timezone: 'Asia/Calcutta', launchedAt: new Date(),
      registrationMode: 'external', registrationLink: opts.landing, oneClickSignup: false, zoomMeetingId: '81234567891', zoomLink: 'https://zoom.example/j/general',
    },
  });
  ids.push(c.id);
  const contact = await db.contact.create({
    data: {
      campaignId: c.id, name: 'Akshat Kumar', email: 'akshat@example.com', account: 'Example', title: 'Director', function: 'Marketing', seniority: 'Director', vertical: 'Test', approved: true,
      ...(opts.registered ? { registeredAt: new Date(), zoomJoinUrl: 'https://leadsquared.zoom.us/w/81234567891?tk=PERSONAL' } : {}),
    },
  });
  // Someone who has registered is never sent another invite, so they are reached by a step that runs on registration.
  const step = opts.registered
    ? { key: 'confirmation', title: 'Confirmation', group: 'Registrant', trigger: 'registration' }
    : { key: 'invite', title: 'Invite', group: 'Pre-registration', trigger: 'launch' };
  await db.cadenceStep.create({ data: { campaignId: c.id, key: step.key, title: step.title, timing: 'Now', channel: 'Email', desc: step.title, group: step.group, trigger: step.trigger, mode: 'template' } });
  await db.cadenceSend.create({ data: { campaignId: c.id, contactId: contact.id, stepKey: step.key, dueAt: new Date(Date.now() - 1000) } });
  vi.mocked(sendNetcoreEmail).mockClear();
  if (opts.body) vi.mocked(resolveStepTemplate).mockResolvedValueOnce({ id: 'template-2', label: 'Invite', channel: 'email', subject: 'Join {{topic}}', body: opts.body, hidden: false } as never);
  await processDueSends(c.id);
  expect(sendNetcoreEmail).toHaveBeenCalledTimes(1);
  const sent = vi.mocked(sendNetcoreEmail).mock.calls[0][0];
  return { text: `${sent.text ?? ''}\n${sent.html ?? ''}`, html: sent.html ?? '', contactId: contact.id, campaignId: c.id };
}
const linkIn = (text: string) => new URL(text.match(/https?:\/\/[^\s"'<>]+/)![0]);

beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  process.env.APP_ORIGIN = originalOrigin;
  await db.deliveryAttempt.deleteMany({ where: { campaignId: { in: ids } } });
  await db.dailySendBudget.deleteMany({ where: { campaignId: { in: ids } } });
  await db.sendQuotaReservation.deleteMany({ where: { campaignId: { in: ids } } });
  await db.campaign.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('the address an invite email shows', () => {
  it('uses Studio\'s own short link when the landing page is on a free builder address and Studio has a better one', async () => {
    const { text, contactId, campaignId } = await sentBody({ landing: FREE_PAGE, studio: STUDIO });
    const link = linkIn(text);
    expect(link.origin).toBe(STUDIO);
    expect(link.pathname.startsWith('/r/')).toBe(true);
    expect(text).not.toContain('framer.app');
    expect(verifyRegistrationToken(link.pathname.slice(3))).toMatchObject({ ok: true, payload: { campaignId, contactId } });

    // and that link really leads to the landing page, with the person's token, without registering anyone
    const res = await shortLink(new Request(link.toString()), { params: Promise.resolve({ token: link.pathname.slice(3) }) } as never);
    const landing = new URL(res.headers.get('location') as string);
    expect(landing.origin + landing.pathname).toBe(FREE_PAGE);
    expect(landing.searchParams.get('source')).toBe('email');
    expect(landing.searchParams.get('token')).toBeTruthy();
    expect(landing.searchParams.get('zoomId')).toBe('81234567891');
    expect((await db.contact.findUniqueOrThrow({ where: { id: contactId } })).registeredAt).toBeNull();
  });

  it('keeps the direct link to a landing page on the operator\'s own domain', async () => {
    const link = linkIn((await sentBody({ landing: OWN_PAGE, studio: STUDIO })).text);
    expect(link.origin + link.pathname).toBe(OWN_PAGE);
    expect(link.searchParams.get('token')).toBeTruthy();
  });

  it('keeps the direct link, with no trace of a tunnel, when Studio is only reachable through one', async () => {
    const { text } = await sentBody({ landing: FREE_PAGE, studio: TUNNEL });
    const link = linkIn(text);
    expect(link.hostname).toBe('my-landing-page.framer.app');
    expect(text).not.toMatch(/trycloudflare|apiOrigin|localhost/);
  });

  it('keeps the direct link when Studio is only on this machine', async () => {
    const { text } = await sentBody({ landing: FREE_PAGE, studio: 'http://localhost:3000' });
    expect(linkIn(text).hostname).toBe('my-landing-page.framer.app');
    expect(text).not.toMatch(/localhost|apiOrigin/);
  });

  it('puts the same better address behind a template\'s {{registrationLink}}, so no template can bring the free address back', async () => {
    const { text } = await sentBody({ landing: FREE_PAGE, studio: STUDIO, body: 'Seat: {{link}} Share: {{registrationLink}}' });
    const urls = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) expect(new URL(u).origin).toBe(STUDIO);
    expect(text).not.toContain('framer.app');
    expect(text).toContain(`${STUDIO}/register/`);
  });

  it('leaves {{registrationLink}} on the landing page itself when Studio has nothing better, with no tunnel in sight', async () => {
    const { text } = await sentBody({ landing: FREE_PAGE, studio: TUNNEL, body: 'Seat: {{link}} Share: {{registrationLink}}' });
    expect(text).toContain('https://my-landing-page.framer.app/');
    expect(text).not.toMatch(/trycloudflare|localhost/);
  });

  it('sends the invite as a real hyperlink with words as its text, never an address shown as text', async () => {
    for (const studio of [STUDIO, TUNNEL]) {
      const { html } = await sentBody({ landing: FREE_PAGE, studio });
      expect(html, studio).toMatch(/<a href="https:\/\/[^"]+">Register here<\/a>/);
      // nothing outside the link's own target looks like an address
      expect(html.replace(/href="[^"]*"/g, ''), studio).not.toMatch(/https?:\/\//);
      expect(html.replace(/href="[^"]*"/g, ''), studio).not.toMatch(/framer\.app|trycloudflare|studio\.leadsquared/);
    }
  });

  it('sends a registered person\'s join link as a "Join the webinar" hyperlink', async () => {
    const { html } = await sentBody({ landing: FREE_PAGE, studio: STUDIO, registered: true });
    expect(html).toContain('>Join the webinar</a>');
    expect(html).toContain('href="https://leadsquared.zoom.us/w/81234567891?tk=PERSONAL"');
  });

  it('gives someone who has already registered their personal join link, never a register link', async () => {
    const { text } = await sentBody({ landing: FREE_PAGE, studio: STUDIO, registered: true });
    expect(linkIn(text).toString()).toBe('https://leadsquared.zoom.us/w/81234567891?tk=PERSONAL');
  });
});

describe('a recipient\'s whole journey on a deployed copy, from the invite email to a registration', () => {
  it('invite email, short link, landing page, form submit: registered once, the waiting follow-ups cancelled, scanners change nothing', async () => {
    // 1. the invite: a hyperlink on Studio's own address, since the landing page is a free builder address
    const { html, contactId, campaignId } = await sentBody({ landing: FREE_PAGE, studio: STUDIO });
    const href = html.match(/<a href="([^"]+)">Register here<\/a>/)![1].replace(/&amp;/g, '&');
    const short = new URL(href);
    expect(short.origin).toBe(STUDIO);
    await db.cadenceStep.create({ data: { campaignId, key: 'nudge', title: 'Nudge', timing: 'T+4d', channel: 'Email', desc: 'Nudge', group: 'Pre-registration', trigger: 'launch', mode: 'template' } });
    await db.cadenceSend.create({ data: { campaignId, contactId, stepKey: 'nudge', dueAt: new Date(Date.now() + 4 * 864e5) } });

    // 2. a mail scanner follows the link, twice, before the person does: it lands on the page and nobody is registered
    const follow = () => shortLink(new Request(short.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LinkScanner)' } }), { params: Promise.resolve({ token: short.pathname.slice(3) }) } as never);
    const scanned = [await follow(), await follow()];
    expect(scanned[1].headers.get('location')).toBe(scanned[0].headers.get('location'));
    expect((await db.contact.findUniqueOrThrow({ where: { id: contactId } })).registeredAt).toBeNull();
    expect(await db.cadenceSend.count({ where: { contactId, stepKey: 'nudge', status: 'queued' } })).toBe(1);

    // 3. the person lands on the page and submits its form, carrying the token from the link
    const landing = new URL(scanned[0].headers.get('location') as string);
    expect(landing.origin + landing.pathname).toBe(FREE_PAGE);
    const submit = () => landingSubmit(new NextRequest('https://studio.leadsquared.com/api/landing/submit', {
      method: 'POST',
      body: JSON.stringify({ campaignId, token: landing.searchParams.get('token'), source: 'email' }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
    }));
    const first = await submit();
    expect(first.status).toBe(200);
    expect((await first.json()).ok).toBe(true);

    // 4. registered as that person, credited to email, and the follow-up invite will never go out
    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.registeredAt).not.toBeNull();
    expect(await db.cadenceSend.count({ where: { contactId, stepKey: 'nudge', status: 'skipped' } })).toBe(1);

    // 5. submitting again (a double click, a retry) changes nothing
    const again = await submit();
    expect(again.status).toBe(200);
    expect(await db.contact.count({ where: { campaignId, registeredAt: { not: null } } })).toBe(1);
  });
});
