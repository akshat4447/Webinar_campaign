import { describe, it, expect, vi } from 'vitest';
import { analyzeLandingPage, frameBlocked, verifyLandingPage } from './landingVerify';

const APP = 'https://studio.example.com';
const H = (o: Record<string, string> = {}) => new Headers(o);
const page = (body: string, over: Partial<Parameters<typeof analyzeLandingPage>[0]['fetched']> = {}) => ({ finalUrl: 'https://lp.example.com/w', status: 200, headers: H(), body, redirects: [], truncated: false, ...over });
const check = (r: ReturnType<typeof analyzeLandingPage>, id: string) => r.checks.find((c) => c.id === id);

describe('analyzeLandingPage', () => {
  it('a page with the Studio script pointing at this Studio and a form passes everything', () => {
    const body = `<html><head><title>AI in Lending</title></head><body><form><input type="email"></form>
      <!-- Universal Webinar Studio + LeadSquared + Zoom Seamless Registration --><script>fetch("${APP}/api/landing/submit")</script></body></html>`;
    const r = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page(body), appOrigin: APP });
    expect(r.overall).toBe('pass');
    expect(r.title).toBe('AI in Lending');
    expect(check(r, 'snippet')?.status).toBe('pass');
  });

  it('warns when the script points at a DIFFERENT Studio (stale copy)', () => {
    const body = `<form><input type="email"></form><script>fetch("https://old.studio.io/api/landing/submit")</script>`;
    const r = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page(body), appOrigin: APP });
    expect(check(r, 'snippet')?.status).toBe('warn');
    expect(check(r, 'snippet')?.fix).toMatch(/Copy the script again/);
  });

  it('a LeadSquared form without the Studio script warns and explains the webhook route', () => {
    const body = `<script>var LSQLeadFields = {};</script><form><input type="email"></form>`;
    const r = analyzeLandingPage({ url: 'https://x.leadsquared.com/p', fetched: page(body), appOrigin: APP });
    expect(r.platform).toBe('leadsquared');
    expect(check(r, 'snippet')).toMatchObject({ status: 'warn' });
    expect(check(r, 'snippet')?.fix).toMatch(/webhook/i);
    expect(r.overall).toBe('warn');
  });

  it('FAILS a page that has neither the script nor a LeadSquared form (registrations would be lost)', () => {
    const r = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page('<html><body><h1>Hi</h1></body></html>'), appOrigin: APP });
    expect(check(r, 'snippet')?.status).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('fails a 404 / 403 with a specific fix', () => {
    const r404 = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page('', { status: 404 }), appOrigin: APP });
    expect(check(r404, 'reachable')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/does not exist/) });
    const r403 = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page('', { status: 403 }), appOrigin: APP });
    expect(check(r403, 'reachable')?.fix).toMatch(/public/);
  });

  it('flags a redirect to a login page as a failure and an ordinary redirect as a warning', () => {
    const login = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page('<form><input type="email"></form>', { finalUrl: 'https://sso.example.com/login', redirects: ['https://sso.example.com/login'] }), appOrigin: APP });
    expect(check(login, 'redirect')?.status).toBe('fail');
    const plain = analyzeLandingPage({ url: 'https://lp.example.com/w', fetched: page('<form><input type="email"></form>', { finalUrl: 'https://lp.example.com/new', redirects: ['https://lp.example.com/new'] }), appOrigin: APP });
    expect(check(plain, 'redirect')?.status).toBe('warn');
  });

  it('warns on http and treats a scheme-less input URL as https', () => {
    const http = analyzeLandingPage({ url: 'http://lp.example.com/w', fetched: page('', { finalUrl: 'http://lp.example.com/w' }), appOrigin: APP });
    expect(check(http, 'https')?.status).toBe('warn');
    const bare = analyzeLandingPage({ url: 'lp.example.com/w', fetched: page(''), appOrigin: APP });
    expect(check(bare, 'https')?.status).toBe('pass');
  });

  it('detects Framer, Webflow and WordPress pages', () => {
    expect(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<div data-framer-name="x"></div>'), appOrigin: APP }).platform).toBe('framer');
    expect(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<html data-wf-site="1">'), appOrigin: APP }).platform).toBe('webflow');
    expect(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<link href="/wp-content/x.css">'), appOrigin: APP }).platform).toBe('wordpress');
    expect(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<p>plain</p>'), appOrigin: APP }).platform).toBe('unknown');
  });

  it('reports embeddability from X-Frame-Options / CSP and says it does not affect registration', () => {
    const blocked = analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<form><input type="email"></form>', { headers: H({ 'x-frame-options': 'SAMEORIGIN' }) }), appOrigin: APP });
    expect(blocked.embeddable).toBe(false);
    expect(check(blocked, 'preview')?.detail).toMatch(/does not affect registration/);
    expect(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('', { headers: H() }), appOrigin: APP }).embeddable).toBe(true);
  });

  it('notes a truncated (very large) page', () => {
    expect(check(analyzeLandingPage({ url: 'https://a.b/c', fetched: page('x', { truncated: true }), appOrigin: APP }), 'size')?.status).toBe('warn');
  });

  it('copes with garbage HTML, empty bodies and no title', () => {
    const r = analyzeLandingPage({ url: 'https://a.b/c', fetched: page('<<<>>><title>'), appOrigin: APP });
    expect(r.title).toBeNull();
    expect(r.checks.length).toBeGreaterThan(0);
  });
});

describe('frameBlocked', () => {
  it('blocks on DENY / SAMEORIGIN and on restrictive frame-ancestors', () => {
    expect(frameBlocked(H({ 'x-frame-options': 'DENY' }))).toBe(true);
    expect(frameBlocked(H({ 'content-security-policy': "frame-ancestors 'self'" }))).toBe(true);
    expect(frameBlocked(H({ 'content-security-policy': "frame-ancestors 'none'" }))).toBe(true);
  });
  it('allows when absent or wildcard', () => {
    expect(frameBlocked(H())).toBe(false);
    expect(frameBlocked(H({ 'content-security-policy': "default-src 'self'" }))).toBe(false);
    expect(frameBlocked(H({ 'content-security-policy': 'frame-ancestors *' }))).toBe(false);
  });
});

describe('verifyLandingPage (end to end with a mocked network)', () => {
  it('refuses private targets with a clear reason, never fetching', async () => {
    const fetchImpl = vi.fn();
    const r = await verifyLandingPage('http://169.254.169.254/latest', APP, fetchImpl as unknown as typeof fetch);
    expect(r.overall).toBe('fail');
    expect(r.checks[0].detail).toMatch(/Private/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reports a timeout in plain language', async () => {
    const r = await verifyLandingPage('https://93.184.216.34/x', APP, (async () => { throw new Error('The operation was aborted due to timeout'); }) as unknown as typeof fetch);
    expect(r.checks[0].detail).toMatch(/too long/);
  });
  it('reports a network error without leaking internals', async () => {
    const r = await verifyLandingPage('https://93.184.216.34/x', APP, (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as typeof fetch);
    expect(r.overall).toBe('fail');
    expect(r.checks[0].detail).toMatch(/could not be reached/);
  });
});
