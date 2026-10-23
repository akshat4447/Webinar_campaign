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
