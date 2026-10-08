import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import { generateUniversalEmbedScript } from './landingPage';

// Runs the generated snippet in a tiny stand-in browser (no real DOM here) to check what it actually does
// when a visitor lands on the page and submits the form.

type Fetched = { url: string; body: Record<string, unknown> };
type El = { style: Record<string, string>; children: unknown[]; appendChild: (c: unknown) => void; setAttribute: () => void; remove: () => void; textContent?: string };

function runSnippet(opts: {
  search: string;
  email?: string;
  session?: Record<string, string>;
  fetchResult?: { status: number; body: Record<string, unknown> };
  noEmailField?: boolean;
  reject?: boolean;
}) {
  const script = generateUniversalEmbedScript({ apiOrigin: 'https://studio.example.com', campaignId: 'camp1' });
  const code = script.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '');
  const fetched: Fetched[] = [];
  const handlers: Array<(e: unknown) => void> = [];
  const emailEl = { value: opts.email ?? 'a@b.co' };
  const form = {
    tagName: 'FORM',
    checkValidity: () => true,
    addEventListener: (_t: string, fn: (e: unknown) => void) => handlers.push(fn),
    querySelector: (sel: string) => (sel === 'input[type="email"]' && !opts.noEmailField ? emailEl : null),
    closest: () => form,
  };
  const notices: string[] = [];
  const collect = (el: El) => {
    if (el.textContent) notices.push(el.textContent);
    el.children.forEach((c) => collect(c as El));
  };
  const body = { appendChild: (el: El) => collect(el) };
  const mkEl = (): El => {
    const el: El = { style: {}, children: [], appendChild(c) { el.children.push(c); }, setAttribute() {}, remove() {} };
    return el;
  };
  const store = new Map(Object.entries(opts.session ?? {}));
  const fetchStub = (url: string, init: { body: string }) => {
    fetched.push({ url, body: JSON.parse(init.body) });
    if (opts.reject) return Promise.reject(new Error('network'));
    const r = opts.fetchResult ?? { status: 200, body: { ok: true, token: 'srv-token' } };
    return Promise.resolve({ status: r.status, json: async () => r.body });
  };
  const sandbox: Record<string, unknown> = {
    window: { location: { search: opts.search, origin: 'https://lp.example.com' }, HTMLInputElement: function () {}, open: vi.fn(), fetch: fetchStub },
    document: {
      readyState: 'complete',
      addEventListener: () => undefined,
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel === 'form' ? [form] : []),
      getElementById: () => null,
      createElement: mkEl,
      body,
    },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    navigator: {},
    URLSearchParams,
    Event: function () {},
    Blob,
    JSON,
    setTimeout: () => 0,
    fetch: fetchStub,
    console,
  };
  vm.runInNewContext(code, sandbox);
  return { fetched, notices, store, submit: () => handlers.forEach((h) => h({ target: form })) };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('generated snippet behaviour', () => {
  it('is valid JavaScript', () => {
    const code = generateUniversalEmbedScript({ apiOrigin: 'https://s.example.com', campaignId: 'c' }).replace(/^[\s\S]*?<script>/, '').replace(/<\/script>\s*$/, '');
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it('sends the channel and personal token from the address bar to this app on submit', () => {
    const r = runSnippet({ search: '?campaignId=camp1&source=whatsapp&utm_source=whatsapp&token=tok123' });
    r.submit();
    expect(r.fetched).toHaveLength(1);
    expect(r.fetched[0].url).toBe('https://studio.example.com/api/landing/submit');
    expect(r.fetched[0].body).toMatchObject({ campaignId: 'camp1', source: 'whatsapp', token: 'tok123', email: 'a@b.co' });
  });

  it('keeps the channel when the form is on a later page of the landing site', () => {
    const first = runSnippet({ search: '?source=linkedin&token=tok9' });
    const saved = Object.fromEntries(first.store);
    const second = runSnippet({ search: '', session: saved });
    second.submit();
    expect(second.fetched[0].body).toMatchObject({ source: 'linkedin', token: 'tok9' });
  });

  it('falls back to "website" only when nothing says where the visitor came from', () => {
    const r = runSnippet({ search: '' });
    r.submit();
    expect(r.fetched[0].body.source).toBe('website');
  });

  it('ignores forms with no email field (search boxes, newsletter signups without email)', () => {
    const r = runSnippet({ search: '?source=email', noEmailField: true });
    r.submit();
    expect(r.fetched).toHaveLength(0);
  });

  it('confirms only after the server accepts, and says so when registration is closed', async () => {
    const ok = runSnippet({ search: '?source=email' });
    ok.submit();
    await flush();
    expect(ok.notices.join(' ')).toContain('You are registered');

    const closed = runSnippet({ search: '?source=email', fetchResult: { status: 409, body: { ok: false } } });
    closed.submit();
    await flush();
    expect(closed.notices.join(' ')).toContain('closed');
    expect(closed.notices.join(' ')).not.toContain('You are registered');
  });

  it('lets the visitor retry after a network failure instead of silently locking the form', async () => {
    const r = runSnippet({ search: '?source=email', reject: true });
    r.submit();
    await flush();
    r.submit();
    expect(r.fetched).toHaveLength(2);
  });

  it('does not offer a calendar link that cannot work when the server returned no token', async () => {
    const r = runSnippet({ search: '?source=email', fetchResult: { status: 200, body: { ok: true, message: 'Registration saved.' } } });
    r.submit();
    await flush();
    const text = r.notices.join(' ');
    expect(text).toContain('You are registered');
    expect(text).toContain('Joining details will be sent by email');
    expect(text).not.toContain('Add to calendar');
  });

  it('offers the calendar link when the server returned a token', async () => {
    const r = runSnippet({ search: '?source=email' });
    r.submit();
    await flush();
    expect(r.notices.join(' ')).toContain('Add to calendar');
  });

  it('contains no emoji', () => {
    expect(generateUniversalEmbedScript({ apiOrigin: 'https://s.example.com', campaignId: 'c' })).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
