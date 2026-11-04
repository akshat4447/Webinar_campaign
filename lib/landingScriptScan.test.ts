import { describe, expect, it } from 'vitest';
import { assetUrls, MAX_ASSETS, sameOrigin, scanPageForStudioScript, scanText } from './landingScriptScan';
import { generateUniversalEmbedScript } from './landingPage';

const html = (body: string) => `<!doctype html><html><head><title>x</title></head><body>${body}</body></html>`;
const res = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/javascript' } });

describe('scanText', () => {
  it('reads the address and webinar out of the script Studio generates', () => {
    const script = generateUniversalEmbedScript({ apiOrigin: 'https://studio.example.com', campaignId: 'cmwcurrentwebinar0000001', zoomId: '81234567891' });
    expect(scanText(script)).toEqual({ found: true, origins: ['https://studio.example.com'], campaignIds: ['cmwcurrentwebinar0000001'] });
  });

  it('reads the values saved on a component placed on the page, which is where an old address hid', () => {
    const bundle = 'ue(Ga,{accentColor:`rgb(37, 99, 235)`,apiOrigin:`https://old-tunnel-name.trycloudflare.com`,campaignId:`cmwoldwebinar0000000001`,zoomId:`81234567891`})';
    expect(scanText(bundle)).toMatchObject({ origins: ['https://old-tunnel-name.trycloudflare.com'], campaignIds: ['cmwoldwebinar0000000001'] });
  });

  it('does not take a property\'s default for a value in use', () => {
    const controls = 'apiOrigin:{title:`API Endpoint`,type:y.String,defaultValue:`https://new.example.com`},campaignId:{title:`Campaign ID`,type:y.String,defaultValue:`cmwcurrentwebinar0000001`}';
    expect(scanText(controls)).toEqual({ found: false, origins: [], campaignIds: [] });
  });

  it('reads the address from a hand-written call to the registration endpoint', () => {
    expect(scanText('fetch("https://studio.example.com/api/landing/submit", {method:"POST"})')).toMatchObject({ found: true, origins: ['https://studio.example.com'] });
  });

  it('treats the same place written differently as one address', () => {
    const t = 'apiOrigin: "https://Studio.Example.com/", x: 1; apiOrigin: "https://studio.example.com/api/landing/submit"; fetch("https://studio.example.com/api/landing/submit")';
    expect(scanText(t).origins).toEqual(['https://studio.example.com']);
  });

  it('ignores an empty or malformed value, and an address that is not http or https', () => {
    for (const t of ['apiOrigin: ""', 'apiOrigin: "not a url"', 'apiOrigin: "ftp://x.example.com"', 'apiOrigin: `javascript:alert(1)`', 'apiOrigin: window.location.origin']) {
      expect(scanText(t).origins, t).toEqual([]);
    }
  });

  it('finds nothing in an ordinary page', () => {
    expect(scanText(html('<form><input type="email"></form>'))).toEqual({ found: false, origins: [], campaignIds: [] });
  });
});

describe('assetUrls', () => {
  const page = 'https://site.example.com/webinar';
  it('returns the page\'s own script files and the page builder\'s published ones, resolved to full addresses', () => {
    const h = html(`<script type="module" src="/app.mjs"></script><link rel="modulepreload" href="https://framerusercontent.com/sites/abc/shared-lib.X1.mjs"><script src="chunks/b.js?v=2"></script>`);
    const urls = assetUrls(h, page);
    expect(urls).toHaveLength(3);
    expect(urls).toEqual(expect.arrayContaining(['https://site.example.com/app.mjs', 'https://site.example.com/chunks/b.js?v=2', 'https://framerusercontent.com/sites/abc/shared-lib.X1.mjs']));
  });
  it('reads a preload link whichever way round its attributes are written', () => {
    expect(assetUrls(html('<link href="/a.mjs" rel="modulepreload">'), page)).toEqual(['https://site.example.com/a.mjs']);
  });
  it('skips other people\'s hosts, files that are not scripts, and addresses that are not web addresses', () => {
    const h = html(`<script src="https://www.googletagmanager.com/gtm.js"></script><script src="https://evil.example.net/x.mjs"></script><link rel="preload" href="/style.css"><script src="javascript:alert(1)"></script><script src="/ok.js"></script>`);
    expect(assetUrls(h, page)).toEqual(['https://site.example.com/ok.js']);
  });
  it('lists a file once and stops at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => `<script src="/f${i}.mjs"></script>`).join('') + '<script src="/f0.mjs"></script>';
    const out = assetUrls(html(many), page);
    expect(out).toHaveLength(MAX_ASSETS);
    expect(new Set(out).size).toBe(out.length);
  });
  it('gives nothing for a page address that is not valid', () => {
    expect(assetUrls(html('<script src="/a.js"></script>'), 'not a url')).toEqual([]);
  });
});

describe('scanPageForStudioScript', () => {
  const publicHost = () => Promise.resolve(['93.184.216.34']);
  const page = { finalUrl: 'https://site.example.com/webinar', body: html('<script type="module" src="/app.mjs"></script><script type="module" src="/other.mjs"></script>') };

  it('finds the script and its settings inside a script file the page loads', async () => {
    const fetchImpl = (async (u: string | URL | Request) => String(u).endsWith('/app.mjs') ? res('x({apiOrigin:`https://old.example.com`,campaignId:`cmwoldwebinar0000000001`}); fetch(o+"/api/landing/submit")') : res('nothing here')) as typeof fetch;
    const scan = await scanPageForStudioScript(page, { fetchImpl, resolve: publicHost });
    expect(scan).toMatchObject({ found: true, origins: ['https://old.example.com'], campaignIds: ['cmwoldwebinar0000000001'], assetsRead: 2 });
  });

  it('puts together what the page and its files say', async () => {
    const withInline = { ...page, body: html(`<script>apiOrigin: "https://new.example.com"; fetch(o + "/api/landing/submit")</script>` + '<script src="/app.mjs"></script>') };
    const fetchImpl = (async () => res('x({apiOrigin:`https://old.example.com`})')) as typeof fetch;
    const scan = await scanPageForStudioScript(withInline, { fetchImpl, resolve: publicHost });
    expect([...scan.origins].sort()).toEqual(['https://new.example.com', 'https://old.example.com']);
  });

  it('skips a file that fails, errors or is not there, and says what it could read', async () => {
    const fetchImpl = (async (u: string | URL | Request) => {
      if (String(u).endsWith('/app.mjs')) throw new Error('network');
      return res('gone', 404);
    }) as typeof fetch;
    const scan = await scanPageForStudioScript(page, { fetchImpl, resolve: publicHost });
    expect(scan).toEqual({ found: false, origins: [], campaignIds: [], assetsRead: 0 });
  });

  it('does not read a file whose address resolves to a private network', async () => {
    let asked = 0;
    const fetchImpl = (async () => { asked++; return res('apiOrigin: "https://x.example.com"; /api/landing/submit'); }) as typeof fetch;
    const scan = await scanPageForStudioScript(page, { fetchImpl, resolve: () => Promise.resolve(['10.0.0.5']) });
    expect(asked).toBe(0);
    expect(scan.found).toBe(false);
  });

  it('works for a page with no script files at all', async () => {
    const scan = await scanPageForStudioScript({ finalUrl: 'https://site.example.com/', body: html('<p>hi</p>') }, { fetchImpl: (async () => res('')) as typeof fetch, resolve: publicHost });
    expect(scan).toEqual({ found: false, origins: [], campaignIds: [], assetsRead: 0 });
  });
});

describe('sameOrigin', () => {
  it('compares scheme, host and port, not case or a path', () => {
    expect(sameOrigin('https://Studio.example.com/', 'https://studio.example.com')).toBe(true);
    expect(sameOrigin('https://studio.example.com/api/x', 'https://studio.example.com')).toBe(true);
    expect(sameOrigin('http://studio.example.com', 'https://studio.example.com')).toBe(false);
    expect(sameOrigin('https://studio.example.com:8443', 'https://studio.example.com')).toBe(false);
    expect(sameOrigin('https://a.example.com', 'https://b.example.com')).toBe(false);
    expect(sameOrigin('nonsense', 'https://studio.example.com')).toBe(false);
  });
});
