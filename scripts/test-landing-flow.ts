import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check of the custom landing page flow, end to end, the way a Framer page behaves: a form that posts
// straight to LeadSquared (a local stand-in for its FormTracker), which then redirects to a thank-you page on
// another subdomain. Both pages carry the generated script. Runs against a production build and a disposable
// database; no signed-in session is used on the pages, because visitors have none.
//
//   npx tsx scripts/test-landing-flow.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-landing-flow.ts
import http from 'node:http';
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV } from './testSignIn';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

const PORT = 3107;
const SITE_PORT = 3108;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const LANDING = `http://www.test-site.example:${SITE_PORT}/webinar`;
const THANKS = `http://thanks.test-site.example:${SITE_PORT}/thank-you`;
const OUT = 'artifacts/verification/landing-flow';
const REGISTRATION_SECRET = 'landing-registration-secret-with-32-plus-characters';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_landing_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET,
    CREDENTIALS_ENCRYPTION_KEY: 'landing-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', LSQ_ACCESS_KEY: '', LSQ_SECRET_KEY: '', LSQ_HOST: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
  });
  let db: Client | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let site: http.Server | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  const checks: string[] = [];
  await mkdir(OUT, { recursive: true });
  try {
    if (spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' }).status) throw new Error('Migrations failed.');
    if (!process.env.SKIP_BUILD && spawnSync('npm', ['run', 'build', '--', '--webpack'], { env, stdio: 'inherit' }).status) throw new Error('Build failed.');
    db = new Client({ connectionString: target.toString() });
    await db.connect();

    // A webinar that takes registrations through the operator's own page, and one invitee with a personal link.
    const campaignId = `cmp${randomBytes(8).toString('hex')}`;
    const contactId = `cnt${randomBytes(8).toString('hex')}`;
    await db.query(
      `INSERT INTO "Campaign" (id, name, vertical, date, "scheduledAt", "durationMinutes", status, "registrationMode", "registrationLink", "oneClickSignup", "zoomLink", "updatedAt")
       VALUES ($1, 'Landing Flow Webinar', 'Test', 'x', now() + interval '7 days', 45, 'live', 'external', $2, false, 'https://zoom.example/j/generic-room', now())`,
      [campaignId, LANDING]
    );
    await db.query(
      `INSERT INTO "Contact" (id, "campaignId", name, email, account, vertical, title, function, seniority, approved, score)
       VALUES ($1, $2, 'Priya Nair', 'priya.invited@example.com', 'Acme', 'Test', 'VP', 'Ops', 'VP', true, 80)`,
      [contactId, campaignId]
    );

    // The script exactly as Studio generates it, and a form shaped like the Framer component (multipart post to
    // the form tracker, hidden redirect address, no channel field of its own).
    process.env.REGISTRATION_SECRET = REGISTRATION_SECRET;
    const { generateUniversalEmbedScript } = await import('@/lib/landingPage');
    const { mintRegistrationToken } = await import('@/lib/registration');
    const script = generateUniversalEmbedScript({ apiOrigin: ORIGIN, campaignId, platform: 'framer', landingUrl: LANDING });
    // The Framer component Studio generates, built the way a page builder builds it (React, with stand-ins for Framer's own packages),
    // once for this Studio and once for an address that does not answer.
    const { generateFramerComponent } = await import('@/lib/framerComponent');
    const bundles = new Map<string, string>();
    const bundleComponent = async (apiOrigin: string): Promise<string> => {
      const source = generateFramerComponent({ apiOrigin, campaignId, zoomId: '81234567891', landingUrl: LANDING });
      const stubs: Record<string, string> = {
        framer: `export const addPropertyControls = () => {}; export const ControlType = { String: 's', Color: 'c' }; export const RenderTarget = { canvas: 'CANVAS', current: () => 'PREVIEW' };`,
        'framer-motion': `import React from 'react'; const make = (tag) => React.forwardRef(({ initial, animate, transition, whileHover, whileTap, ...rest }, ref) => React.createElement(tag, { ...rest, ref })); export const motion = { div: make('div'), button: make('button') };`,
        'webinar-component': source,
      };
      const out = await build({
        stdin: {
          contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import Landing from 'webinar-component';
            createRoot(document.getElementById('root')).render(React.createElement(Landing, { accentColor: '#2563eb', backgroundColor: '#f8fafc', cardBgColor: '#ffffff', badgeText: 'Live', headline: 'Test webinar', subheadline: 'Sub', dateText: 'Thu', timeText: '10:00', speakerName: 'Sam', speakerRole: 'Host', keyPoint1: 'One', keyPoint2: 'Two', keyPoint3: 'Three', googleFormBackupUrl: 'https://forms.gle/backup' }));`,
          resolveDir: process.cwd(), loader: 'tsx',
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'transform', define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [{ name: 'stubs', setup(b) {
          b.onResolve({ filter: /^(framer|framer-motion|webinar-component)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: a.path === 'webinar-component' ? 'tsx' : 'js', resolveDir: process.cwd() }));
        } }],
      });
      return out.outputFiles[0].text;
    };
    bundles.set('/bundle/good.js', await bundleComponent(ORIGIN));
    bundles.set('/bundle/dead.js', await bundleComponent('http://127.0.0.1:9'));
    const deadScript = generateUniversalEmbedScript({ apiOrigin: 'http://127.0.0.1:9', campaignId, platform: 'framer', landingUrl: LANDING });
    const TRACKER = `http://www.test-site.example:${SITE_PORT}/t/FormTracker.aspx`;
    const formHtml = (extra = '') => `<form id="reg" ${extra} method="post" enctype="multipart/form-data" action="${TRACKER}">
        <input type="hidden" name="MXHRedirectUrl" value="${THANKS}">
        <input type="hidden" name="mx_WebinarID" value="000 0000 0000">
        <input name="FirstName" required placeholder="Name"><input type="email" name="EmailAddress" required placeholder="Email">
        <input type="tel" name="Phone" required placeholder="Phone"><button type="submit">Submit</button>
      </form>`;
    const shell = (body: string, title = 'Page') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script}</body></html>`;
    // A form that handles its own submit and stays on the page, the way Framer's built-in forms do.
    const inlineForm = (after: string) => `${formHtml('data-inline="1"')}<div id="status"></div>
      <script>document.getElementById('reg').addEventListener('submit', function (e) {
        e.preventDefault();
        var data = new FormData(e.target);
        fetch(${JSON.stringify(TRACKER)}, { method: 'POST', body: data, mode: 'no-cors' }).then(function () { ${after} });
      });</script>`;
    const pageFor = (pathname: string): string => {
      switch (pathname) {
        case '/thank-you': return shell('<h1>Thanks for registering</h1>', 'Thank you');
        case '/webinar/late': // the form is added to the page seconds after load, as a lazily loaded section would be
          return shell(`<div id="slot"></div><script>setTimeout(function () { document.getElementById('slot').innerHTML = ${JSON.stringify(formHtml())}; }, 3000);</script>`);
        case '/webinar/spa': // a site that changes page without reloading it
          return shell(`<div id="app"><a href="/webinar/spa/form" id="go">Register</a></div><script>
            window.__marker = 'same-document';
            document.getElementById('go').addEventListener('click', function (e) {
              e.preventDefault();
              history.pushState(null, '', '/webinar/spa/form');
              document.getElementById('app').innerHTML = ${JSON.stringify(formHtml())};
            });</script>`);
        case '/webinar/inline':
          return shell(inlineForm(`document.getElementById('status').textContent = 'Thanks, you are in.';`));
        case '/webinar/spa-redirect':
          return shell(`<div id="app">${inlineForm(`window.__marker = 'same-document'; history.pushState(null, '', '/webinar/spa-thanks'); document.getElementById('app').innerHTML = '<h1>Thanks, you are in.</h1>';`)}</div>`);
        case '/webinar/unreachable': // the script points at an address that no longer answers (a tunnel that closed): the form stays on the page
          return `<!doctype html><html><head><meta charset="utf-8"><title>Unreachable</title></head><body>${inlineForm(`document.getElementById('status').textContent = 'Reserving...';`)}${deadScript}</body></html>`;
        case '/webinar/twice': // the same copy of the script pasted twice
          return `<!doctype html><html><head><meta charset="utf-8"><title>Twice</title></head><body>${inlineForm(`document.getElementById('status').textContent = 'Thanks, you are in.';`)}${script}${script}</body></html>`;
        case '/webinar/component': // the generated Framer component, pointed at this Studio
          return `<!doctype html><html><head><meta charset="utf-8"><title>Component</title></head><body><div id="root"></div><script src="/bundle/good.js"></script></body></html>`;
        case '/webinar/component-dead': // the same component, built for an address that does not answer
          return `<!doctype html><html><head><meta charset="utf-8"><title>Component</title></head><body><div id="root"></div><script src="/bundle/dead.js"></script></body></html>`;
        case '/blog': // an unrelated newsletter box on the same site
          return shell(`<form method="post" action="/newsletter"><input type="email" name="email" required placeholder="Newsletter email"><button type="submit">Subscribe</button></form>`, 'Blog');
        default:
          return shell(formHtml());
      }
    };
    const tracked: string[] = [];
    site = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'POST' && url.pathname === '/t/FormTracker.aspx') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          tracked.push(raw);
          const redirect = /name="MXHRedirectUrl"\r\n\r\n([^\r]*)/.exec(raw)?.[1] ?? THANKS;
          res.writeHead(302, { location: redirect });
          res.end();
        });
        return;
      }
      if (req.method === 'POST') {
        req.resume();
        req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('subscribed'); });
        return;
      }
      if (url.pathname.startsWith('/bundle/')) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(bundles.get(url.pathname) ?? '');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageFor(url.pathname));
    });
    await new Promise<void>((r) => site!.listen(SITE_PORT, '127.0.0.1', r));

    server = spawn('node', ['scripts/start-server.cjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout?.on('data', (d) => logs.push(String(d)));
    server.stderr?.on('data', (d) => logs.push(String(d)));
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      try { ready = (await fetch(`${ORIGIN}/api/health`)).ok; } catch { /* not up yet */ }
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error('Server did not start: ' + logs.join(''));

    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--host-resolver-rules=MAP *.test-site.example 127.0.0.1'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' || host.endsWith('.test-site.example') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const popup = page.getByRole('dialog', { name: 'You are registered' });
    const filled = async (email: string) => {
      await page.getByPlaceholder('Name').fill('Sam Visitor');
      await page.getByPlaceholder('Email').fill(email);
      await page.getByPlaceholder('Phone').fill('+919876543210');
    };

    // ---- 1. a cold visitor from an SMS link submits the form
    await page.goto(`${LANDING}?campaignId=${campaignId}&source=sms&utm_source=sms`);
    await filled('sam.cold@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();

    // The form still went to LeadSquared's tracker, carrying the channel in the attribution field...
    await expect.poll(() => tracked.length, { timeout: 15_000 }).toBe(1);
    expect(tracked[0]).toMatch(/name="mx_Channel_Source"\r\n\r\nsms\r\n/);
    expect(tracked[0]).toContain('sam.cold@example.com');
    // ...and LeadSquared's redirect was marked, so a thank-you page on another site can tell too.
    expect(tracked[0]).toMatch(/webinar_reg=/);
    checks.push('1. The form still posts to LeadSquared and now carries the channel (mx_Channel_Source=sms), and the redirect address is marked for the thank-you page');

    // ---- 2. the thank-you page, on another subdomain, opens the calendar pop-up
    await expect(page).toHaveURL(new RegExp(`^${THANKS.replace(/[.]/g, '\\.')}`));
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await expect(popup).toContainText('Landing Flow Webinar');
    await expect(popup).toContainText('Your joining details will be sent by email.');
    for (const label of ['Google Calendar', 'Outlook', 'Microsoft 365', 'Apple (.ics)']) await expect(popup.getByRole('link', { name: label })).toBeVisible();
    await expect(popup.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    await expect(popup.getByRole('link', { name: 'Outlook', exact: true })).toHaveAttribute('href', /^https:\/\/outlook\.live\.com\//);
    await expect(popup.getByRole('link', { name: 'Microsoft 365' })).toHaveAttribute('href', /^https:\/\/outlook\.office\.com\//);
    await page.screenshot({ path: `${OUT}/thank-you-popup.png` });
    checks.push('2. The thank-you page (another subdomain) opens the "You are registered" pop-up with Google, Outlook, Microsoft 365 and Apple buttons');

    // ---- 3. the Apple button downloads a real calendar file
    const [download] = await Promise.all([page.waitForEvent('download'), popup.getByRole('link', { name: 'Apple (.ics)' }).click()]);
    expect(download.suggestedFilename()).toBe('webinar.ics');
    const ics = await readFile((await download.path())!, 'utf8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Landing Flow Webinar');
    expect(ics).not.toContain('generic-room');
    checks.push('3. The Apple button downloads webinar.ics for the right webinar, without the shared Zoom link');

    // ---- 4. Studio registered the visitor, under the channel from the link, even though the page left
    await expect.poll(async () => (await db!.query(`SELECT "registrationSource","registeredAt" FROM "Contact" WHERE email='sam.cold@example.com'`)).rows[0]?.registrationSource, { timeout: 15_000 }).toBe('sms');
    expect((await db.query(`SELECT "registeredAt" FROM "Contact" WHERE email='sam.cold@example.com'`)).rows[0].registeredAt).not.toBeNull();
    checks.push('4. Studio registered the visitor under SMS even though the browser left the page (the background post survived the redirect)');

    // ---- 5. close it, and it does not come back
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(popup).toHaveCount(0);
    checks.push('5. Escape closes the pop-up and a reload does not bring it back');

    // ---- 6. a thank-you page nobody was sent to shows nothing
    const fresh = await browser.newContext();
    await fresh.route('**/*', (route) => (new URL(route.request().url()).hostname.endsWith('.test-site.example') || new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    const stranger = await fresh.newPage();
    await stranger.goto(THANKS);
    await stranger.waitForTimeout(1500);
    await expect(stranger.getByRole('dialog')).toHaveCount(0);
    await fresh.close();
    checks.push('6. Someone who opens the thank-you page without having registered sees no pop-up');

    // ---- 7. an invitee with a personal link: registered through the token, credited to email
    const token = mintRegistrationToken(campaignId, contactId);
    await page.goto(`${LANDING}?campaignId=${campaignId}&source=email&utm_source=email&token=${encodeURIComponent(token)}`);
    await filled('priya.invited@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect.poll(() => tracked.length, { timeout: 15_000 }).toBe(2);
    expect(tracked[1]).toMatch(/name="mx_Channel_Source"\r\n\r\nemail_campaign\r\n/);
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await db!.query(`SELECT "registrationSource" FROM "Contact" WHERE id=$1 AND "registeredAt" IS NOT NULL`, [contactId])).rows[0]?.registrationSource, { timeout: 15_000 }).toBe('email');
    checks.push('7. An invitee with a personal link is registered as themselves, credited to email, and LeadSquared gets the channel as email_campaign');

    // ---- Pages built the way Framer builds them. Each is a real registration through the same script.
    const registered = async (email: string, source: string) => {
      await expect.poll(async () => (await db!.query(`SELECT "registrationSource" FROM "Contact" WHERE email=$1 AND "registeredAt" IS NOT NULL`, [email])).rows[0]?.registrationSource, { timeout: 15_000 }).toBe(source);
    };
    const SITE = `http://www.test-site.example:${SITE_PORT}`;

    // ---- 8. a form that only appears a few seconds after the page loads (lazily loaded sections)
    const beforeLate = tracked.length;
    await page.goto(`${SITE}/webinar/late?campaignId=${campaignId}&source=whatsapp&utm_source=whatsapp`);
    await expect(page.getByPlaceholder('Email')).toBeVisible({ timeout: 10_000 });
    await filled('sam.late@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect.poll(() => tracked.length, { timeout: 15_000 }).toBe(beforeLate + 1);
    expect(tracked[beforeLate]).toMatch(/name="mx_Channel_Source"\r\n\r\nwhatsapp\r\n/);
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await registered('sam.late@example.com', 'whatsapp');
    checks.push('8. A form that appears seconds after the page loads is still registered, and its channel and pop-up still work');

    // ---- 9. a site that changes page without reloading: the form is reached by an in-page link
    await page.goto(`${SITE}/webinar/spa?campaignId=${campaignId}&source=linkedin&utm_source=linkedin`);
    await page.getByRole('link', { name: 'Register' }).click();
    await expect(page).toHaveURL(/\/webinar\/spa\/form/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same-document');
    await filled('sam.spa@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await registered('sam.spa@example.com', 'linkedin');
    checks.push('9. A form reached without a page reload (how Framer navigates) is registered under its channel');

    // ---- 10. a form that handles its own submit and stays on the page (Framer built-in forms)
    await page.goto(`${SITE}/webinar/inline?campaignId=${campaignId}&source=sms&utm_source=sms`);
    await filled('sam.inline@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.locator('#status')).toHaveText('Thanks, you are in.');
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/webinar\/inline/);
    await registered('sam.inline@example.com', 'sms');
    await page.keyboard.press('Escape');
    checks.push('10. A form that stays on the page gets the pop-up straight away, and its own channel field reaches LeadSquared');

    // ---- 11. a form that "redirects" to its thank-you page without reloading
    await page.goto(`${SITE}/webinar/spa-redirect?campaignId=${campaignId}&source=email&utm_source=email`);
    await filled('sam.spared@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/\/webinar\/spa-thanks/);
    await expect(popup).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same-document');
    await registered('sam.spared@example.com', 'email');
    await page.keyboard.press('Escape');
    checks.push('11. A thank-you page reached without a reload still opens the pop-up');

    // ---- 12. an unrelated newsletter box on another page of the site is not a webinar registration
    await page.goto(`${SITE}/blog`);
    await page.getByPlaceholder('Newsletter email').fill('reader.newsletter@example.com');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await page.waitForTimeout(2500);
    expect((await db.query(`SELECT 1 FROM "Contact" WHERE email='reader.newsletter@example.com'`)).rowCount).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    checks.push('12. A newsletter form on another page of the same site is left alone: no contact is created and no pop-up opens');

    // ---- 13. the address the script sends to no longer answers: the visitor is told, and can try again
    await page.goto(`${SITE}/webinar/unreachable?campaignId=${campaignId}&source=email&utm_source=email`);
    await filled('nobody.unreachable@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByRole('status').filter({ hasText: /could not complete your registration/i })).toBeVisible({ timeout: 20_000 });
    await expect(popup).toHaveCount(0);
    expect((await db.query(`SELECT 1 FROM "Contact" WHERE email='nobody.unreachable@example.com'`)).rowCount).toBe(0);
    let retried = 0;
    page.on('request', (r) => { if (r.url().includes('/api/landing/submit')) retried++; });
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect.poll(() => retried, { timeout: 10_000 }).toBeGreaterThan(0);
    checks.push('13. When the address the script sends to does not answer, the visitor is told the registration did not go through, nothing is recorded, and they can try again');

    // ---- 14. the same copy of the script pasted twice sends one registration, not two
    const submits: string[] = [];
    const onRequest = (r: { url(): string }) => { if (r.url().includes('/api/landing/submit')) submits.push(r.url()); };
    page.on('request', onRequest);
    await page.goto(`${SITE}/webinar/twice?campaignId=${campaignId}&source=whatsapp&utm_source=whatsapp`);
    await filled('twice.pasted@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    page.off('request', onRequest);
    expect(submits).toHaveLength(1);
    await registered('twice.pasted@example.com', 'whatsapp');
    await page.keyboard.press('Escape');
    checks.push('14. The same copy of the script pasted twice sends one registration, not two');

    // ---- 15. the complete component Studio generates, pasted as one file: an invitee fills it in and presses the button
    const componentContactId = `cnt${randomBytes(8).toString('hex')}`;
    await db.query(
      `INSERT INTO "Contact" (id, "campaignId", name, email, account, vertical, title, function, seniority, approved, score)
       VALUES ($1, $2, 'Casey Component', 'casey.component@example.com', 'Acme', 'Test', 'VP', 'Ops', 'VP', true, 70)`,
      [componentContactId, campaignId]
    );
    const componentToken = mintRegistrationToken(campaignId, componentContactId);
    await page.goto(`${SITE}/webinar/component?campaignId=${campaignId}&source=email&utm_source=email&token=${encodeURIComponent(componentToken)}`);
    await expect(page.getByRole('button', { name: /Register for Webinar/ })).toBeVisible();
    await page.locator('input[name="FirstName"]').fill('Casey');
    await page.locator('input[name="EmailAddress"]').fill('casey.component@example.com');
    await page.locator('input[name="Phone"]').fill('+919876543210');
    await page.getByRole('button', { name: /Register for Webinar/ }).click();
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Register for Webinar/ })).toBeEnabled();
    await registered('casey.component@example.com', 'email');
    await expect(page).toHaveURL(/\/webinar\/component/);
    await page.keyboard.press('Escape');
    checks.push('15. The complete component Studio generates, pasted as one file with nothing else added, registers an invitee as themselves, credited to email, and shows the calendar pop-up');

    // ---- 16. the same component built for an address that does not answer: the visitor is told, in the form itself
    await page.goto(`${SITE}/webinar/component-dead?campaignId=${campaignId}&source=email&utm_source=email`);
    await page.locator('input[name="FirstName"]').fill('Dana');
    await page.locator('input[name="EmailAddress"]').fill('dana.dead@example.com');
    await page.locator('input[name="Phone"]').fill('+919876543210');
    await page.getByRole('button', { name: /Register for Webinar/ }).click();
    await expect(page.getByRole('alert')).toContainText(/could not complete your registration/i, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'backup form' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Register for Webinar/ })).toBeEnabled();
    await expect(popup).toHaveCount(0);
    expect((await db.query(`SELECT 1 FROM "Contact" WHERE email='dana.dead@example.com'`)).rowCount).toBe(0);
    checks.push('16. The same component built for an address that does not answer tells the visitor in the form, offers the backup form, records nothing, and lets them try again');

    // ---- 17. the joining link is made a few seconds after registering: the pop-up's calendar buttons pick it up
    // A webinar with a Zoom event gives each person their own link, made when they register. (Without one, everybody gets the shared room.)
    await db.query(`UPDATE "Campaign" SET "zoomMeetingId"='81234567891' WHERE id=$1`, [campaignId]);
    const lateContactId = `cnt${randomBytes(8).toString('hex')}`;
    await db.query(
      `INSERT INTO "Contact" (id, "campaignId", name, email, account, vertical, title, function, seniority, approved, score)
       VALUES ($1, $2, 'Lee Late', 'late.link@example.com', 'Acme', 'Test', 'VP', 'Ops', 'VP', true, 60)`,
      [lateContactId, campaignId]
    );
    const lateToken = mintRegistrationToken(campaignId, lateContactId);
    await page.goto(`${SITE}/webinar/inline?campaignId=${campaignId}&source=email&utm_source=email&token=${encodeURIComponent(lateToken)}`);
    await filled('late.link@example.com');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(popup).toBeVisible({ timeout: 20_000 });
    const google = popup.getByRole('link', { name: 'Google Calendar' });
    const detailsOfGoogle = async () => new URL((await google.getAttribute('href')) as string).searchParams.get('details') ?? '';
    // At first: the wording, in the description, with the speakers block and the Join URL line
    await expect.poll(detailsOfGoogle).toContain('Join URL: Joining details will be sent to you by email');
    expect(new URL((await google.getAttribute('href')) as string).searchParams.get('location')).toBe('Joining details will be sent to you by email');
    await expect(popup).toContainText('Your joining details will be sent by email.');
    // Zoom issues the link; the same buttons now carry it
    await db.query(`UPDATE "Contact" SET "zoomJoinUrl"='https://zoom.example/w/late-link-xyz' WHERE id=$1`, [lateContactId]);
    await expect.poll(detailsOfGoogle, { timeout: 30_000 }).toContain('Join URL: https://zoom.example/w/late-link-xyz');
    expect(await detailsOfGoogle()).not.toContain('Joining details will be sent to you by email');
    await expect(popup).toContainText('Your joining link has been added to the calendar buttons below.');
    const outlook = new URL((await popup.getByRole('link', { name: 'Microsoft 365' }).getAttribute('href')) as string).searchParams;
    expect(outlook.get('location')).toBe('https://zoom.example/w/late-link-xyz');
    await page.keyboard.press('Escape');
    checks.push('17. The calendar buttons say "Join URL: Joining details will be sent to you by email" at first, and carry the real joining link once Zoom has made it, without the visitor doing anything');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify({ checks }, null, 2));
    console.log(`Landing flow checks passed: ${checks.length}.\n` + checks.map((c) => `  - ${c}`).join('\n'));
  } catch (error) { await captureBrowserFailure(browser, OUT, error); throw error; } finally {
    await writeFile(`${OUT}/server.log`, logs.join('')).catch(() => undefined);
    await db?.end();
    await browser?.close();
    await new Promise<void>((r) => (site ? site.close(() => r()) : r()));
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((r) => server!.once('exit', () => r()));
    }
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
