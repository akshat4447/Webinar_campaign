import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check of the sign-in: the gate in front of the studio, the sign-in page, wrong and right credentials,
// sign-out, tampered cookies, the open redirect, brute-force limiting, and the endpoints that must stay public.
// Runs against a production build and a disposable database; nothing else is reachable.
//
//   npx tsx scripts/test-login.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-login.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TEST_LOGIN_ENV } from './testSignIn';

const PORT = 3105;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/login';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_login_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'login-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'login-encryption-key-with-32-plus-characters',
    CRON_SECRET: 'isolated-browser-scheduler-secret-over-32-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', ZOOM_CLIENT_ID: '', ZOOM_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
  });
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  const checks: string[] = [];
  await mkdir(OUT, { recursive: true });
  try {
    if (spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' }).status) throw new Error('Migrations failed.');
    if (!process.env.SKIP_BUILD && spawnSync('npm', ['run', 'build', '--', '--webpack'], { env, stdio: 'inherit' }).status) throw new Error('Build failed.');
    server = spawn('node', ['scripts/start-server.cjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout?.on('data', (d) => logs.push(String(d)));
    server.stderr?.on('data', (d) => logs.push(String(d)));
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      try { ready = (await fetch(`${ORIGIN}/api/health`)).ok; } catch { /* not up yet */ }
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error('Server did not start: ' + logs.join(''));

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const noFollow = (path: string, init: Parameters<typeof fetch>[1] = {}) => fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

    // ---- 1. the gate
    await page.goto(`${ORIGIN}/`);
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await page.goto(`${ORIGIN}/dashboard`);
    await expect(page).toHaveURL(`${ORIGIN}/login?next=%2Fdashboard`);
    await page.goto(`${ORIGIN}/campaigns/abc/overview?x=1`);
    await expect(page).toHaveURL(`${ORIGIN}/login?next=%2Fcampaigns%2Fabc%2Foverview%3Fx%3D1`);
    checks.push('1a. Every studio page sends a signed-out visitor to the sign-in page, remembering where they were going');
    for (const [method, path] of [['POST', '/api/wizard/draft'], ['POST', '/api/auth/zoom/callback'], ['POST', '/dashboard'], ['GET', '/api/wizard/draft']] as const) {
      const res = await noFollow(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(res.status, `${method} ${path}`).toBe(path === '/dashboard' ? 401 : 401);
    }
    checks.push('1b. APIs and form posts from a signed-out client get a 401, not a page of HTML');
    for (const path of ['/login', '/r/result', '/register/nothing', '/campaigns/nothing.css']) {
      const result = await noFollow(path, { method: 'POST', headers: { 'next-action': '00'.repeat(20), 'content-type': 'text/plain', origin: ORIGIN }, body: '[]' });
      expect(result.status, `${path} refuses anonymous action replay before Next parses it`).toBe(401);
    }
    checks.push('1d. Public and static-looking paths cannot accept an anonymous server-action replay');
    // Zoom and LinkedIn bring the browser back to a /api address after the person approves, with a one-time code in
    // it. A signed-out visit there is a page visit: sign in and carry on, never a bare JSON error.
    for (const path of ['/api/auth/zoom/callback?code=abc123&state=s1', '/api/auth/linkedin/callback?code=abc123&state=s1', '/api/auth/zoom/connect?returnTo=%2Fcampaigns%2Fnew', '/api/auth/linkedin/connect']) {
      const res = await noFollow(path);
      expect(res.status, path).toBe(307);
      const where = new URL(res.headers.get('location') ?? '', ORIGIN);
      expect(where.pathname, path).toBe('/login');
      expect(where.searchParams.get('next'), path).toBe(path);
    }
    checks.push('1c. Zoom and LinkedIn connect and return addresses send a signed-out person to sign in and back, with the one-time code kept');

    // ---- 2. what stays public: not stopped by the gate (a route may still answer 400, 401 for a bad signature, 404...)
    const gated = async (res: Response) => res.status === 307 || (await res.clone().text()).includes('Sign in required');
    const publicChecks: Array<[string, Parameters<typeof fetch>[1]?]> = [
      ['/api/health'], ['/api/landing/submit', { method: 'OPTIONS' }], ['/api/landing/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/api/calendar/nothing'], ['/register/nothing'], ['/r/result?status=registered'], ['/api/webhooks/zoom', { method: 'POST', body: '{}' }],
      ['/api/webhooks/netcore', { method: 'POST', body: '{}' }], ['/api/cron/cadence'],
    ];
    for (const [path, init] of publicChecks) expect(await gated(await noFollow(path, init)), `${path} must not be behind the sign-in`).toBe(false);
    expect((await noFollow('/api/health')).status).toBe(200);
    expect((await noFollow('/api/cron/cadence')).status).toBe(401);
    expect((await noFollow('/api/cron/cadence', { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })).status).toBe(200);
    expect((await noFollow('/api/landing/submit', { method: 'OPTIONS' })).status).toBe(204);
    expect((await noFollow('/r/result?status=registered')).status).toBe(200);
    // The sign-in page itself is set in the brand font, so the font files must load before anyone has signed in.
    const font = await noFollow('/fonts/Mulish-Regular.ttf');
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type') ?? '').toContain('font');
    checks.push('2. Attendee/provider endpoints stay reachable without operator sign-in; the worker independently requires scheduler configuration');

    // ---- 3. the page
    await page.goto(`${ORIGIN}/login`);
    await page.screenshot({ path: `${OUT}/login-desktop.png`, fullPage: true });
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${OUT}/login-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.getByLabel('Username')).toBeFocused();
    checks.push('3. The sign-in page has focus on the username, fits a phone, and has no serious accessibility violations');

    // ---- 4. wrong credentials
    await page.getByLabel('Username').fill(TEST_LOGIN_ENV.APP_USERNAME);
    await page.getByLabel(/^Password/).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The username or password is not correct.' })).toBeVisible();
    await expect(page).toHaveURL(/\/login\?error=invalid/);
    const wrongUserMessage = await (async () => {
      await page.getByLabel('Username').fill('nobody');
      await page.getByLabel(/^Password/).fill(TEST_LOGIN_ENV.APP_PASSWORD);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      return page.getByRole('alert').filter({ hasText: /not correct/ }).first().innerText();
    })();
    expect(wrongUserMessage).toBe('The username or password is not correct.'); // the message never says which half was wrong
    expect((await context.cookies()).some((c) => c.name === 'webinar_session')).toBe(false);
    await page.goto(`${ORIGIN}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
    checks.push('4. A wrong username or password shows one message that does not say which was wrong, and gives no session');

    // ---- 5. right credentials, with the keyboard, to the page that was asked for
    await page.goto(`${ORIGIN}/login?next=%2Fdashboard`);
    await page.getByLabel('Username').fill(`  ${TEST_LOGIN_ENV.APP_USERNAME}  `);
    await page.getByLabel(/^Password/).fill(TEST_LOGIN_ENV.APP_PASSWORD);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(`${ORIGIN}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === 'webinar_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 6 * 24 * 3600);
    await page.reload();
    await expect(page).toHaveURL(`${ORIGIN}/dashboard`);
    await page.goto(`${ORIGIN}/login`);
    await expect(page).toHaveURL(`${ORIGIN}/`); // already signed in: the sign-in page is skipped
    await expect(page.getByRole('link', { name: 'Integrations' })).toBeVisible();
    checks.push('5. Signing in (Enter works, spaces around the username are ignored) returns to the page asked for; the cookie is HttpOnly and lasts a week; a refresh stays signed in');

    // ---- 6. signed in, the same things now work
    expect((await context.request.post(`${ORIGIN}/api/wizard/draft`, { data: { campaignId: null, step: 0, patch: {} }, headers: { 'sec-fetch-site': 'same-origin' } })).status()).toBe(200);
    checks.push('6. The same endpoints answer normally once signed in');

    // ---- 7. sign out
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await page.goto(`${ORIGIN}/dashboard`);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    expect((await context.cookies()).some((c) => c.name === 'webinar_session' && c.value)).toBe(false);
    checks.push('7. Sign Out ends the session and the studio is locked again');

    // ---- 8. tampered and stale cookies
    const real = await (async () => {
      const res = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: TEST_LOGIN_ENV.APP_USERNAME, password: TEST_LOGIN_ENV.APP_PASSWORD }) });
      expect(res.status).toBe(303);
      return /webinar_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1];
    })();
    expect((await noFollow('/dashboard', { headers: { cookie: `webinar_session=${real}` } })).status).toBe(200);
    const [exp, user, sig] = real.split('.');
    for (const forged of [`${exp}.${user}.${sig.replace(/.$/, sig.endsWith('0') ? '1' : '0')}`, `${Number(exp) + 100000}.${user}.${sig}`, `${exp}.${Buffer.from('admin').toString('base64url')}.${sig}`, 'garbage', `${Math.floor(Date.now() / 1000) - 10}.${user}.${sig}`]) {
      const res = await noFollow('/dashboard', { headers: { cookie: `webinar_session=${forged}` } });
      expect(res.status, forged).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
    }
    checks.push('8. A session that is altered, forged, malformed or expired is refused');

    // ---- 9. open redirect
    for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const res = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: TEST_LOGIN_ENV.APP_USERNAME, password: TEST_LOGIN_ENV.APP_PASSWORD, next: bad }) });
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    }
    const crossSite = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ username: TEST_LOGIN_ENV.APP_USERNAME, password: TEST_LOGIN_ENV.APP_PASSWORD }) });
    expect(crossSite.status).toBe(403);
    checks.push('9. The "next" address can only be a path on this site, and a sign-in posted from another site is refused');

    // ---- 10. guessing is limited (the attempts above already used some of the allowance)
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: TEST_LOGIN_ENV.APP_USERNAME, password: `guess-${i}` }) });
      limited = (res.headers.get('location') ?? '').includes('error=rate');
    }
    expect(limited, 'repeated attempts are limited').toBe(true);
    const right = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: TEST_LOGIN_ENV.APP_USERNAME, password: TEST_LOGIN_ENV.APP_PASSWORD }) });
    expect(right.headers.get('location') ?? '').toContain('error=rate'); // even the right password waits once the limit is hit
    await page.goto(`${ORIGIN}/login?error=rate`);
    await expect(page.getByRole('alert').filter({ hasText: 'Too many attempts' })).toBeVisible();
    checks.push('10. Repeated attempts from one address are limited, and the page says so');

    let accountLimited = false;
    for (let i = 0; i < 35 && !accountLimited; i++) {
      const res = await noFollow('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i + 1}` }, body: JSON.stringify({ username: 'unknown', password: 'wrong' }) });
      accountLimited = (res.headers.get('location') || '').includes('error=rate');
    }
    expect(accountLimited, 'account budget holds when caller-supplied forwarding headers vary').toBe(true);
    checks.push('11. Varying forwarding headers cannot bypass the account-wide login limit');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify({ checks }, null, 2));
    console.log(`Sign-in checks passed: ${checks.length}.\n` + checks.map((c) => `  - ${c}`).join('\n'));
  } catch (error) { await captureBrowserFailure(browser, OUT, error); throw error; } finally {
    await writeFile(`${OUT}/server.log`, logs.join('')).catch(() => undefined);
    await browser?.close();
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
  process.exitCode = 1;
});
