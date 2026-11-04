import { describe, it, expect } from 'vitest';
import { buildInviteLink, hostedFormUrl, publicRegistrationAddress, publicRegistrationUrl, registrationModeOf } from './inviteLink';
import { verifyRegistrationToken } from './registration';

const ORIGIN = 'https://studio.example.com';
const contact = { id: 'ct1', name: 'Priya Nair', email: 'priya@acme.com', phone: '+919876543210', account: 'Acme', title: 'VP', registeredAt: null, zoomJoinUrl: null };
const base = { id: 'camp1', name: 'AI in Lending', oneClickSignup: true, registrationLink: null, zoomLink: 'https://zoom.us/j/1', zoomMeetingId: '1' };

describe('registrationModeOf', () => {
  it('honours an explicit mode', () => {
    expect(registrationModeOf({ registrationMode: 'zoom', registrationLink: 'https://l.example/x', oneClickSignup: false })).toBe('zoom');
    expect(registrationModeOf({ registrationMode: 'external', registrationLink: 'https://l.example/x', oneClickSignup: true })).toBe('external');
  });
  it('treats "external" with no landing URL as zoom, so a half-configured webinar still yields a working link', () => {
    expect(registrationModeOf({ registrationMode: 'external', registrationLink: null, oneClickSignup: true })).toBe('zoom');
    expect(registrationModeOf({ registrationMode: 'external', registrationLink: '   ', oneClickSignup: true })).toBe('zoom');
  });
  it('falls back to the legacy implicit rule for rows that predate the column', () => {
    expect(registrationModeOf({ registrationLink: 'https://l.example/x', oneClickSignup: false })).toBe('external');
    expect(registrationModeOf({ registrationLink: 'https://l.example/x', oneClickSignup: true })).toBe('zoom');
    expect(registrationModeOf({ registrationLink: null, oneClickSignup: false })).toBe('zoom');
  });
});

describe('buildInviteLink — zoom mode', () => {
  it('one-click: signed /r/<token> link carrying the channel, no personal data', () => {
    const link = buildInviteLink({ campaign: { ...base, registrationMode: 'zoom' }, contact, channel: 'whatsapp', appOrigin: ORIGIN });
    const u = new URL(link);
    expect(u.origin + u.pathname.split('/').slice(0, 2).join('/')).toBe(ORIGIN + '/r');
    expect(u.searchParams.get('source')).toBe('whatsapp');
    const token = u.pathname.split('/')[2];
    expect(verifyRegistrationToken(token)).toMatchObject({ ok: true, payload: { campaignId: 'camp1', contactId: 'ct1' } });
    expect(link).not.toContain('priya');
    expect(link).not.toContain('9876');
  });

  it('with one-click off, links to the hosted form with channel and signed token', () => {
    const link = buildInviteLink({ campaign: { ...base, registrationMode: 'zoom', oneClickSignup: false }, contact, channel: 'sms', appOrigin: ORIGIN });
    const u = new URL(link);
    expect(u.pathname).toBe('/register/camp1');
    expect(u.searchParams.get('c')).toBe('sms');
    expect(verifyRegistrationToken(u.searchParams.get('t') as string).ok).toBe(true);
  });

  it('defaults the channel to email and lower-cases it', () => {
    expect(new URL(buildInviteLink({ campaign: base, contact, appOrigin: ORIGIN })).searchParams.get('source')).toBe('email');
    expect(new URL(buildInviteLink({ campaign: base, contact, channel: 'LinkedIn', appOrigin: ORIGIN })).searchParams.get('source')).toBe('linkedin');
  });

  it('strips a trailing slash from the app origin', () => {
    expect(buildInviteLink({ campaign: base, contact, appOrigin: ORIGIN + '/' })).toMatch(/^https:\/\/studio\.example\.com\/r\/[^/]+\?source=email$/);
  });
});

describe('buildInviteLink — external landing page', () => {
  const ext = { ...base, registrationMode: 'external', registrationLink: 'https://webinar.example.com/ai-lending' };

  it('uses a short /r/<token> redirect for length-limited channels (LinkedIn note, SMS)', () => {
    for (const channel of ['linkedin', 'sms']) {
      const link = buildInviteLink({ campaign: { ...ext, landingPrefill: true }, contact, channel, appOrigin: ORIGIN });
      const u = new URL(link);
      expect(u.origin).toBe(ORIGIN);
      expect(u.pathname.startsWith('/r/')).toBe(true);
      expect(u.searchParams.get('source')).toBe(channel);
      expect(link.length).toBeLessThan(260);
      for (const pii of ['priya', 'Priya', '9876', 'Acme']) expect(link).not.toContain(pii);
      expect(verifyRegistrationToken(u.pathname.slice(3)).ok).toBe(true);
    }
  });

  it('uses the landing page with UTM + signed token', () => {
    const u = new URL(buildInviteLink({ campaign: ext, contact, channel: 'whatsapp', appOrigin: ORIGIN }));
    expect(u.origin + u.pathname).toBe('https://webinar.example.com/ai-lending');
    expect(u.searchParams.get('utm_source')).toBe('whatsapp');
    expect(u.searchParams.get('source')).toBe('whatsapp');
    expect(u.searchParams.get('campaignId')).toBe('camp1');
    expect(verifyRegistrationToken(u.searchParams.get('token') as string).ok).toBe(true);
  });

  it('keeps personal data OUT of the URL unless prefill is switched on', () => {
    const off = buildInviteLink({ campaign: { ...ext, landingPrefill: false }, contact, appOrigin: ORIGIN });
    for (const pii of ['priya', 'Priya', '9876', 'Acme', 'EmailAddress', 'FirstName']) expect(off).not.toContain(pii);
    const on = new URL(buildInviteLink({ campaign: { ...ext, landingPrefill: true }, contact, appOrigin: ORIGIN }));
    expect(on.searchParams.get('EmailAddress')).toBe('priya@acme.com');
    expect(on.searchParams.get('FirstName')).toBe('Priya');
  });

  it('preserves an existing query string and fragment-free output on the landing URL', () => {
    const u = new URL(buildInviteLink({ campaign: { ...ext, registrationLink: 'https://l.example/x?ref=partner' }, contact, appOrigin: ORIGIN }));
    expect(u.searchParams.get('ref')).toBe('partner');
    expect(u.searchParams.get('utm_source')).toBe('email');
  });

  it('accepts a scheme-less landing URL', () => {
    const u = new URL(buildInviteLink({ campaign: { ...ext, registrationLink: 'webinar.example.com/go' }, contact, appOrigin: ORIGIN }));
    expect(u.hostname).toBe('webinar.example.com');
  });

  it('a different contact gets a different token (links are per person)', () => {
    const a = new URL(buildInviteLink({ campaign: ext, contact, appOrigin: ORIGIN })).searchParams.get('token');
    const b = new URL(buildInviteLink({ campaign: ext, contact: { ...contact, id: 'ct2' }, appOrigin: ORIGIN })).searchParams.get('token');
    expect(a).not.toBe(b);
  });
});

describe('buildInviteLink — which address the message shows', () => {
  const free = { ...base, registrationMode: 'external', registrationLink: 'https://my-landing-page.framer.app/' };
  const own = { ...base, registrationMode: 'external', registrationLink: 'https://webinar.leadsquared.com/ai' };
  const STUDIO = 'https://studio.leadsquared.com';
  const TUNNEL = 'https://old-tunnel-name.trycloudflare.com';

  it('a page on a free builder address gets Studio\'s own short link when Studio is on a better address', () => {
    for (const channel of ['email', 'whatsapp', 'linkedin', 'sms']) {
      const link = buildInviteLink({ campaign: free, contact, channel, appOrigin: STUDIO });
      const u = new URL(link);
      expect(u.origin, channel).toBe(STUDIO);
      expect(u.pathname.startsWith('/r/'), channel).toBe(true);
      expect(u.searchParams.get('source'), channel).toBe(channel);
      expect(link).not.toContain('framer.app');
      expect(verifyRegistrationToken(u.pathname.slice(3)), channel).toMatchObject({ ok: true, payload: { campaignId: 'camp1', contactId: 'ct1' } });
    }
  });

  it('a page on the operator\'s own domain keeps the direct link, even when Studio is also on its own domain', () => {
    const u = new URL(buildInviteLink({ campaign: own, contact, channel: 'email', appOrigin: STUDIO }));
    expect(u.origin + u.pathname).toBe('https://webinar.leadsquared.com/ai');
    expect(u.searchParams.get('token')).toBeTruthy();
  });

  it('keeps the direct link when Studio has nothing better to offer, and never puts a tunnel or local address in the message', () => {
    for (const studio of [TUNNEL, 'http://localhost:3000', 'https://127.0.0.1:3101', 'https://other.framer.app', 'https://studio.onrender.com', '']) {
      const link = buildInviteLink({ campaign: free, contact, channel: 'email', appOrigin: studio });
      expect(new URL(link).hostname, studio).toBe('my-landing-page.framer.app');
      expect(link, studio).not.toMatch(/trycloudflare|localhost|127\.0\.0\.1|onrender|apiOrigin/);
    }
  });

  it('never leaks Studio\'s address into a direct link as a parameter', () => {
    const link = buildInviteLink({ campaign: own, contact, channel: 'email', appOrigin: STUDIO });
    expect(new URL(link).searchParams.has('apiOrigin')).toBe(false);
    expect(link).not.toContain('studio.leadsquared.com');
  });

  it('does not change zoom mode, whose links already point at Studio', () => {
    const link = buildInviteLink({ campaign: { ...base, registrationMode: 'zoom' }, contact, channel: 'email', appOrigin: STUDIO });
    expect(new URL(link).origin).toBe(STUDIO);
  });

  it('a registered contact still gets the join link, whatever the addresses are', () => {
    const registered = { ...contact, registeredAt: new Date(), zoomJoinUrl: 'https://zoom.us/w/1?tk=PERSONAL' };
    expect(buildInviteLink({ campaign: free, contact: registered, channel: 'email', appOrigin: STUDIO })).toBe('https://zoom.us/w/1?tk=PERSONAL');
  });

  it('an external webinar with no landing page yet behaves as zoom mode instead of building a broken link', () => {
    const link = buildInviteLink({ campaign: { ...base, registrationMode: 'external', registrationLink: null }, contact, channel: 'email', appOrigin: STUDIO });
    expect(new URL(link).origin).toBe(STUDIO);
  });
});

describe('publicRegistrationAddress (the {{registrationLink}} placeholder)', () => {
  const free = { ...base, registrationMode: 'external', registrationLink: 'https://my-landing-page.framer.app/' };
  const own = { ...base, registrationMode: 'external', registrationLink: 'https://webinar.leadsquared.com/ai' };
  it('is Studio\'s own /register link, which redirects to the landing page, when that is the better address', () => {
    const a = publicRegistrationAddress({ campaign: free, channel: 'email', appOrigin: 'https://studio.leadsquared.com' });
    expect(a).toBe('https://studio.leadsquared.com/register/camp1?c=email');
    expect(a).not.toContain('framer.app');
  });
  it('is the landing page itself when it is on the operator\'s own domain, or Studio has nothing better, and never a tunnel', () => {
    expect(publicRegistrationAddress({ campaign: own, appOrigin: 'https://studio.leadsquared.com' })).toBe('https://webinar.leadsquared.com/ai');
    for (const studio of ['https://x.trycloudflare.com', 'http://localhost:3000', '']) {
      expect(publicRegistrationAddress({ campaign: free, appOrigin: studio }), studio).toBe('https://my-landing-page.framer.app/');
    }
  });
  it('is empty when there is no landing page, so the caller falls back to the person\'s own link', () => {
    expect(publicRegistrationAddress({ campaign: { ...base, registrationMode: 'zoom' }, appOrigin: 'https://studio.leadsquared.com' })).toBe('');
    expect(publicRegistrationAddress({ campaign: { ...base, registrationMode: 'external', registrationLink: '  ' }, appOrigin: 'https://studio.leadsquared.com' })).toBe('');
  });
});

describe('buildInviteLink — already registered', () => {
  it('sends the personal Zoom join link, never another "register here"', () => {
    const registered = { ...contact, registeredAt: new Date(), zoomJoinUrl: 'https://zoom.us/w/1?tk=PERSONAL' };
    expect(buildInviteLink({ campaign: base, contact: registered, appOrigin: ORIGIN })).toBe('https://zoom.us/w/1?tk=PERSONAL');
    expect(buildInviteLink({ campaign: { ...base, registrationMode: 'external', registrationLink: 'https://l.example/x' }, contact: registered, appOrigin: ORIGIN })).toBe('https://zoom.us/w/1?tk=PERSONAL');
  });
  it('falls back to the event link when no personal link exists', () => {
    expect(buildInviteLink({ campaign: base, contact: { ...contact, registeredAt: new Date() }, appOrigin: ORIGIN })).toBe('https://zoom.us/j/1');
  });
  it('is empty (not a broken URL) when the webinar has no link at all', () => {
    expect(buildInviteLink({ campaign: { id: 'c', zoomLink: null, registrationLink: null }, contact: { ...contact, registeredAt: new Date() }, appOrigin: ORIGIN })).toBe('');
  });
});

describe('public hosted links', () => {
  it('builds a contact-free hosted form link per channel', () => {
    const u = new URL(publicRegistrationUrl(ORIGIN, 'camp 1', 'website'));
    expect(u.pathname).toBe('/register/camp%201');
    expect(u.searchParams.get('c')).toBe('website');
    expect(u.searchParams.get('t')).toBeNull();
  });
  it('includes a token only when given', () => {
    expect(hostedFormUrl(ORIGIN, 'c', 'email', 'tok')).toContain('t=tok');
  });
});
