import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import { generateUniversalEmbedScript } from './landingPage';

// Runs the generated snippet in a tiny stand-in browser (no real DOM here) to check what it actually does
// when a visitor lands on the page, submits the form, and later reaches the thank-you page.

type Fetched = { url: string; body: Record<string, unknown> | null };
type El = {
  id?: string;
  href?: string;
  style: Record<string, string>;
  children: El[];
  textContent?: string;
  appendChild: (c: El) => void;
  setAttribute: (k: string, v: string) => void;
  remove: () => void;
  focus: () => void;
};

const EVENT = {
  ok: true,
  event: { title: 'AI Banking Webinar', start: '2026-10-28T07:08:00.000Z', end: '2026-10-28T08:08:00.000Z', personal: false },
  calendar: {
    google: 'https://calendar.google.com/calendar/render?x=1',
    outlookLive: 'https://outlook.live.com/calendar/0/deeplink/compose?x=1',
    outlookOffice: 'https://outlook.office.com/calendar/0/deeplink/compose?x=1',
    ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
  },
};

function runSnippet(opts: {
  search?: string;
  email?: string;
  session?: Record<string, string>;
  cookie?: string;
  host?: string;
  /** The page still holds an email field (a landing page), as opposed to a thank-you page. */
  pageHasEmailField?: boolean;
  submitResult?: { status: number; body: Record<string, unknown> };
  eventResult?: { status: number; body: unknown } | 'fail';
  noEmailField?: boolean;
  existingAttributionField?: boolean;
  redirectUrl?: string;
  reject?: boolean;
  replaceState?: (a: unknown, b: string, url: string) => void;
  /** The landing page address baked into the script, and the path of the page the script is running on. */
  landingUrl?: string;
  path?: string;
}) {
  const script = generateUniversalEmbedScript({ apiOrigin: 'https://studio.example.com', campaignId: 'camp1abcdef', landingUrl: opts.landingUrl });
  const code = script.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '');
  const fetched: Fetched[] = [];
  const handlers: Array<(e: unknown) => void> = []; // document-level 'submit' (capture) listeners
  const keyHandlers: Array<(e: unknown) => void> = [];

  const emailEl = { value: opts.email ?? 'a@b.co' };
  const injected: Array<{ name?: string; type?: string; value?: string }> = [];
  const attributionEl: { value: string } | null = opts.existingAttributionField ? { value: '' } : null;
  const redirectEl = opts.redirectUrl ? { value: opts.redirectUrl } : null;
  const form = {
    tagName: 'FORM',
    checkValidity: () => true,
    addEventListener: () => undefined,
    querySelector: (sel: string) => {
      if (sel === 'input[type="email"]' && !opts.noEmailField) return emailEl;
      if (sel.includes('mx_Channel_Source')) return attributionEl ?? injected.find((i) => i.name === 'mx_Channel_Source') ?? null;
      if (sel.includes('MXHRedirectUrl')) return redirectEl;
      return null;
    },
    appendChild: (c: { name?: string; type?: string; value?: string }) => void injected.push(c),
    closest: () => form,
  };

  const texts: string[] = [];
  const hrefs: Array<{ text: string; href: string; download?: string }> = [];
  const collect = (el: El) => {
    if (el.textContent) texts.push(el.textContent);
    if (el.href) hrefs.push({ text: el.textContent ?? '', href: el.href });
    el.children.forEach(collect);
  };
  const body = { appendChild: (el: El) => collect(el) };
  const mkEl = (): El => {
    const el: El = { style: {}, children: [], appendChild(c) { el.children.push(c); }, setAttribute() {}, remove() {}, focus() {} };
    return el;
  };

  // A cookie jar that behaves like a browser's: a Domain must be a real site (two labels or more) the host is inside.
  const host = opts.host ?? 'www.example.com';
  const jar = new Map<string, string>();
  if (opts.cookie) {
    const i = opts.cookie.indexOf('=');
    jar.set(opts.cookie.slice(0, i), opts.cookie.slice(i + 1));
  }
  const cookieWrites: string[] = [];
  const documentObj: Record<string, unknown> = {
    readyState: 'complete',
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'keydown') keyHandlers.push(fn);
      if (type === 'submit') handlers.push(fn);
    },
    removeEventListener: () => undefined,
    querySelector: (sel: string) => (sel === 'input[type="email"]' && opts.pageHasEmailField ? emailEl : null),
    querySelectorAll: (sel: string) => (sel === 'form' && opts.pageHasEmailField !== false && !opts.cookie ? [form] : []),
    getElementById: () => null,
    createElement: mkEl,
    body,
  };
  Object.defineProperty(documentObj, 'cookie', {
    get: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    set: (raw: string) => {
      cookieWrites.push(raw);
      const parts = raw.split(';').map((p) => p.trim());
      const [name, ...rest] = parts[0].split('=');
      const attrs = new Map(parts.slice(1).map((p) => { const [k, v] = p.split('='); return [k.toLowerCase(), v ?? '']; }));
      const domain = attrs.get('domain');
      if (domain && (domain.split('.').length < 2 || !(host === domain || host.endsWith(`.${domain}`)))) return; // rejected
      if (attrs.get('max-age') === '0') jar.delete(name);
      else jar.set(name, rest.join('='));
    },
  });

  const store = new Map(Object.entries(opts.session ?? {}));
  const fetchStub = (url: string, init?: { body?: string }) => {
    fetched.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('/api/landing/event')) {
      if (opts.eventResult === 'fail') return Promise.reject(new Error('network'));
      const r = opts.eventResult ?? { status: 200, body: EVENT };
      return Promise.resolve({ status: r.status, json: async () => r.body });
    }
    if (opts.reject) return Promise.reject(new Error('network'));
    const r = opts.submitResult ?? { status: 200, body: { ok: true, token: 'srv-token' } };
    return Promise.resolve({ status: r.status, json: async () => r.body });
  };
  const sandbox: Record<string, unknown> = {
    window: {
      location: { search: opts.search ?? '', pathname: opts.path ?? '/webinar', origin: 'https://lp.example.com', hostname: host, protocol: 'https:', href: `https://${host}/page` },
      HTMLInputElement: function () {},
      open: vi.fn(),
      history: { replaceState: opts.replaceState ?? (() => undefined) },
      fetch: fetchStub,
      Blob,
      URL,
    },
    document: documentObj,
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    navigator: {},
    URLSearchParams,
    URL,
    Event: function () {},
    Blob,
    JSON,
    Date,
    setTimeout: () => 0,
    setInterval: () => 0,
    fetch: fetchStub,
    console,
  };
  vm.runInNewContext(code, sandbox);
  return {
    fetched, texts, hrefs, store, jar, injected, redirectEl, attributionEl, cookieWrites, keyHandlers,
    submit: () => handlers.forEach((h) => h({ target: form })),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
const freshCookie = (value: Record<string, unknown>) => `webinar_reg=${encodeURIComponent(JSON.stringify({ at: Date.now(), ...value }))}`;

describe('generated snippet behaviour', () => {
  it('is valid JavaScript', () => {
    const code = generateUniversalEmbedScript({ apiOrigin: 'https://s.example.com', campaignId: 'c' }).replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '');
    expect(() => new vm.Script(code)).not.toThrow();
  });

  describe('on the landing page', () => {
    it('sends the channel and personal token from the address bar to this app on submit', () => {
      const r = runSnippet({ search: '?campaignId=camp1abcdef&source=whatsapp&utm_source=whatsapp&token=tok123' });
      r.submit();
      const post = r.fetched.find((f) => f.url.endsWith('/api/landing/submit'));
      expect(post?.url).toBe('https://studio.example.com/api/landing/submit');
      expect(post?.body).toMatchObject({ campaignId: 'camp1abcdef', source: 'whatsapp', token: 'tok123', email: 'a@b.co' });
    });

    it('keeps the channel when the form is on a later page of the landing site', () => {
      const first = runSnippet({ search: '?source=linkedin&token=tok9' });
      const saved = Object.fromEntries(first.store);
      const second = runSnippet({ search: '', session: saved });
      second.submit();
      expect(second.fetched.find((f) => f.url.endsWith('/submit'))?.body).toMatchObject({ source: 'linkedin', token: 'tok9' });
    });

    it('falls back to "website" only when nothing says where the visitor came from', () => {
      const r = runSnippet({});
      r.submit();
      expect(r.fetched.find((f) => f.url.endsWith('/submit'))?.body?.source).toBe('website');
    });

    it('ignores forms with no email field (search boxes, newsletter signups without email)', () => {
      const r = runSnippet({ search: '?source=email', noEmailField: true });
      r.submit();
      expect(r.fetched.filter((f) => f.url.endsWith('/submit'))).toHaveLength(0);
    });

    it('lets the visitor retry after a network failure instead of silently locking the form', async () => {
      const r = runSnippet({ search: '?source=email', reject: true });
      r.submit();
      await flush();
      r.submit();
      expect(r.fetched.filter((f) => f.url.endsWith('/submit'))).toHaveLength(2);
    });
  });

  describe('telling the registration form from other forms on the same site', () => {
    const landingUrl = 'https://lp.example.com/webinar';
    const submitted = (o: Parameters<typeof runSnippet>[0]) => {
      const r = runSnippet({ landingUrl, ...o });
      r.submit();
      return r.fetched.some((f) => f.url.endsWith('/api/landing/submit'));
    };

    it('registers a form on the landing page, or any page under it', () => {
      expect(submitted({ path: '/webinar' })).toBe(true);
      expect(submitted({ path: '/webinar/' })).toBe(true);
      expect(submitted({ path: '/webinar/step-2' })).toBe(true);
    });

    it('leaves a newsletter box on another page alone', () => {
      expect(submitted({ path: '/blog/post' })).toBe(false);
      expect(submitted({ path: '/' })).toBe(false);
      expect(submitted({ path: '/webinars-archive' })).toBe(false); // a longer word, not a page under the landing page
    });

    it('still registers a form on any page for a visitor who arrived from a campaign link', () => {
      expect(submitted({ path: '/register-now', search: '?source=sms' })).toBe(true);
    });

    it('does not treat a later newsletter box as a registration just because the visitor followed a campaign link earlier', () => {
      const earlier = { webinar_attribution_camp1abcdef: JSON.stringify({ source: 'email', token: 't' }) };
      expect(submitted({ path: '/blog/post', session: earlier })).toBe(false);
      expect(submitted({ path: '/webinar/step-2', session: earlier })).toBe(true);
    });

    it('still registers a form on any page that carries LeadSquared’s own hidden fields', () => {
      const r = runSnippet({ landingUrl, path: '/somewhere', redirectUrl: 'https://thanks.example.com/' });
      r.submit();
      expect(r.fetched.some((f) => f.url.endsWith('/api/landing/submit'))).toBe(true);
    });

    it('acts on every form when it was generated without a landing address', () => {
      expect(submitted({ landingUrl: undefined, path: '/anything' })).toBe(true);
    });
  });

  describe('the attribution field sent to LeadSquared', () => {
    it('adds the field to a form that has none, holding the channel under the name Studio reports it by', () => {
      const email = runSnippet({ search: '?source=email' });
      email.submit();
      expect(email.injected).toEqual([expect.objectContaining({ name: 'mx_Channel_Source', type: 'hidden', value: 'email_campaign' })]);

      const sms = runSnippet({ search: '?source=sms' });
      sms.submit();
      expect(sms.injected[0].value).toBe('sms');

      const sales = runSnippet({ search: '?source=sdr_sales' });
      sales.submit();
      expect(sales.injected[0].value).toBe('sdr_sales');

      const none = runSnippet({});
      none.submit();
      expect(none.injected[0].value).toBe('website');
    });

    it('fills the form’s own field when it already has one, instead of adding a second', () => {
      const r = runSnippet({ search: '?source=whatsapp', existingAttributionField: true });
      r.submit();
      expect(r.injected).toHaveLength(0);
      expect(r.attributionEl?.value).toBe('whatsapp');
    });
  });

  describe('handing over to the thank-you page', () => {
    it('remembers the registration in a cookie the whole site can read, for half an hour, without any personal token', () => {
      const r = runSnippet({ search: '?source=email&token=tok123' });
      r.submit();
      const record = JSON.parse(decodeURIComponent(r.jar.get('webinar_reg') ?? ''));
      expect(record).toMatchObject({ c: 'camp1abcdef' });
      expect(record.t).toBeUndefined();
      expect(decodeURIComponent(r.jar.get('webinar_reg') ?? '')).not.toContain('tok123');
      const accepted = r.cookieWrites.filter((w) => w.startsWith('webinar_reg=') && !w.includes('Max-Age=0') && w.includes('Domain=example.com'));
      expect(accepted.length).toBeGreaterThan(0);
      expect(accepted[0]).toContain('Max-Age=1800');
      expect(accepted[0]).toContain('Secure');
    });

    it('also marks the redirect address, for a thank-you page on another site', () => {
      const r = runSnippet({ search: '?source=email', redirectUrl: 'https://www.other.com/thanks?x=1' });
      r.submit();
      const url = new URL(r.redirectEl!.value);
      expect(url.searchParams.get('webinar_reg')).toBe('camp1abcdef');
      expect(url.searchParams.get('x')).toBe('1');
    });

    it('leaves a form without a redirect field alone', () => {
      expect(() => runSnippet({ search: '?source=email' }).submit()).not.toThrow();
    });
  });

  describe('the calendar pop-up', () => {
    it('opens on the thank-you page with Google, Outlook, Microsoft 365 and Apple buttons, then forgets the registration', async () => {
      const r = runSnippet({ cookie: freshCookie({ c: 'camp1abcdef', t: 'tok123' }), pageHasEmailField: false });
      await flush();
      expect(r.fetched[0].url).toBe('https://studio.example.com/api/landing/event?c=camp1abcdef');
      expect(r.texts.join(' ')).toContain('You are registered');
      expect(r.texts.join(' ')).toContain('AI Banking Webinar');
      expect(r.hrefs.map((h) => h.text)).toEqual(['Google Calendar', 'Outlook', 'Microsoft 365', 'Apple (.ics)']);
      expect(r.hrefs[0].href).toBe(EVENT.calendar.google);
      expect(r.hrefs[3].href).toMatch(/^blob:|^data:text\/calendar/);
      expect(r.jar.has('webinar_reg')).toBe(false);
    });

    it('still opens when only the redirect address says the person registered (no cookie, no token)', async () => {
      const r = runSnippet({ search: '?webinar_reg=camp1abcdef', pageHasEmailField: false });
      await flush();
      expect(r.fetched[0].url).toBe('https://studio.example.com/api/landing/event?c=camp1abcdef');
      expect(r.texts.join(' ')).toContain('You are registered');
    });

    it('takes the marker out of the address bar once used, so a refresh does not open it again', async () => {
      const seen: string[] = [];
      const r = runSnippet({ search: '?webinar_reg=camp1abcdef&utm=1', pageHasEmailField: false, replaceState: (_a, _b, url) => void seen.push(url) });
      await flush();
      expect(r.texts.join(' ')).toContain('You are registered');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe('https://www.example.com/page');
    });

    it('says the joining details arrive by email unless the calendar entry carries a personal link', async () => {
      const generic = runSnippet({ cookie: freshCookie({ c: 'camp1abcdef' }), pageHasEmailField: false });
      await flush();
      expect(generic.texts.join(' ')).toContain('Your joining details will be sent by email.');

      const personal = runSnippet({
        cookie: freshCookie({ c: 'camp1abcdef', t: 'tok' }),
        pageHasEmailField: false,
        eventResult: { status: 200, body: { ...EVENT, event: { ...EVENT.event, personal: true } } },
      });
      await flush();
      expect(personal.texts.join(' ')).not.toContain('will be sent by email');
    });

    it('does not open on the page that still holds the registration form', async () => {
      const r = runSnippet({ cookie: freshCookie({ c: 'camp1abcdef' }), pageHasEmailField: true });
      await flush();
      expect(r.fetched.filter((f) => f.url.includes('/event'))).toHaveLength(0);
      expect(r.texts).toEqual([]);
    });

    it('does not open for a registration older than half an hour, or for a stranger who never registered', async () => {
      const old = runSnippet({ cookie: `webinar_reg=${encodeURIComponent(JSON.stringify({ c: 'camp1abcdef', at: Date.now() - 31 * 60_000 }))}`, pageHasEmailField: false });
      await flush();
      expect(old.texts).toEqual([]);
      const nobody = runSnippet({ pageHasEmailField: false });
      await flush();
      expect(nobody.texts).toEqual([]);
    });

    it('refuses a malformed webinar id from the address bar instead of calling this app with it', async () => {
      const r = runSnippet({ search: '?webinar_reg=../../admin', pageHasEmailField: false });
      await flush();
      expect(r.fetched).toHaveLength(0);
    });

    it('falls back to a plain confirmation, without calendar buttons, when the details cannot be fetched', async () => {
      const failed = runSnippet({ cookie: freshCookie({ c: 'camp1abcdef' }), pageHasEmailField: false, eventResult: 'fail' });
      await flush();
      expect(failed.texts.join(' ')).toContain('You are registered');
      expect(failed.texts.join(' ')).toContain('Your joining details will be sent by email.');
      expect(failed.hrefs).toEqual([]);

      const unscheduled = runSnippet({ cookie: freshCookie({ c: 'camp1abcdef' }), pageHasEmailField: false, eventResult: { status: 200, body: { ok: true, event: null } } });
      await flush();
      expect(unscheduled.hrefs).toEqual([]);
    });

    it('opens right away on a form that keeps the visitor on the page, using the token the server returned', async () => {
      const r = runSnippet({ search: '?source=email', pageHasEmailField: true });
      r.submit();
      await flush();
      const event = r.fetched.find((f) => f.url.includes('/event'));
      expect(event?.url).toBe('https://studio.example.com/api/landing/event?c=camp1abcdef&t=srv-token');
      expect(r.texts.join(' ')).toContain('You are registered');
    });

    it('never asks for a personal calendar entry with the token from the address bar, only one the server returned', async () => {
      const r = runSnippet({ search: '?source=email&token=forwarded-token', pageHasEmailField: true, submitResult: { status: 200, body: { ok: true, message: 'Registration saved.' } } });
      r.submit();
      await flush();
      const event = r.fetched.find((f) => f.url.includes('/event'));
      expect(event?.url).toBe('https://studio.example.com/api/landing/event?c=camp1abcdef');
    });

    it('says so, and shows no pop-up, when registration is closed', async () => {
      const r = runSnippet({ search: '?source=email', pageHasEmailField: true, submitResult: { status: 409, body: { ok: false } } });
      r.submit();
      await flush();
      expect(r.texts.join(' ')).toContain('closed');
      expect(r.texts.join(' ')).not.toContain('You are registered');
      expect(r.fetched.filter((f) => f.url.includes('/event'))).toHaveLength(0);
    });
  });

  it('bakes no calendar link into the script, so a changed date or Zoom link cannot leave a stale one behind', () => {
    const script = generateUniversalEmbedScript({ apiOrigin: 'https://s.example.com', campaignId: 'c' });
    expect(script).not.toContain('calendar.google.com');
    expect(script).not.toContain('outlook.live.com');
  });

  it('contains no emoji', () => {
    expect(generateUniversalEmbedScript({ apiOrigin: 'https://s.example.com', campaignId: 'c' })).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
