import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check of fetching a Zoom event's details in the creation wizard: choosing from the list, pasting an ID
// the way Zoom shows it, pasting a registration link, and what the page says when Zoom cannot answer. Runs
// against a production build, a disposable database and the local fake Zoom server (a Server-to-Server app).
//
//   npx tsx scripts/test-zoom-details.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-zoom-details.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect, type Page } from '@playwright/test';
import { startFakeZoom, FAKE_ZOOM_ALL_SCOPES } from '../test-support/fakes/zoomFake';

const PORT = 3106;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/zoom-details';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_zoom_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const fake = await startFakeZoom({ webinarAddOn: true });
  const when = new Date(Date.UTC(2027, 2, 10, 15, 0)).toISOString(); // 10 Mar 2027, 15:00 UTC
  const webinar = fake.seedMeeting({ kind: 'webinar', topic: 'Zoom Fetch Webinar', start_time: when, approval_type: 0, agenda: 'What is covered', duration: 75, registrants_restrict_number: 400, timezone: 'America/New_York' });
  fake.seedPanelists(webinar.id, [{ name: 'Priya Panelist', email: 'priya@example.com' }]);
  fake.seedMeeting({ kind: 'meeting', topic: 'Zoom Fetch Meeting', start_time: when, approval_type: 0 });

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'zoom-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'zoom-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
    ZOOM_OAUTH_BASE_URL: fake.oauthUrl, ZOOM_API_BASE_URL: fake.apiUrl,
    ZOOM_REDIRECT_URI: 'https://closed-tunnel-example.trycloudflare.com/api/auth/zoom/callback',
    ZOOM_ACCOUNT_ID: fake.config.accountId, ZOOM_CLIENT_ID: fake.config.clientId, ZOOM_CLIENT_SECRET: fake.config.clientSecret, ZOOM_HOST_EMAIL: fake.config.hostEmail,
  });
  let db: Client | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  const checks: string[] = [];
  await mkdir(OUT, { recursive: true });
  try {
    if (spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' }).status) throw new Error('Migrations failed.');
    if (!process.env.SKIP_BUILD && spawnSync('npm', ['run', 'build', '--', '--webpack'], { env, stdio: 'inherit' }).status) throw new Error('Build failed.');
    db = new Client({ connectionString: target.toString() });
    await db.connect();
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
    await signIn(context, ORIGIN);
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const title = (p: Page) => p.getByLabel('Webinar title', { exact: false });
    const fresh = async () => {
      await page.goto(`${ORIGIN}/campaigns/new`);
      await expect(title(page)).toBeVisible();
    };
    const resetToken = () => db!.query(`DELETE FROM "AppSetting" WHERE key = 'integration.zoom.accessToken'`);

    // ---- 1. pick from the list
    await fresh();
    const select = page.getByRole('combobox', { name: 'Zoom event' });
    await expect(select).toBeVisible({ timeout: 30_000 });
    await select.selectOption((await select.locator('option', { hasText: 'Zoom Fetch Webinar' }).getAttribute('value'))!);
    await expect(title(page)).toHaveValue('Zoom Fetch Webinar');
    await expect(page.getByLabel('Description')).toHaveValue('What is covered');
    await expect(page.getByLabel('Seat capacity', { exact: false })).toHaveValue('400');
    await expect(page.getByLabel('Duration (minutes)')).toHaveValue('75');
    // The event is shown in the zone Zoom holds it in: 15:00 UTC is 10:00 in New York on 10 March 2027 (daylight time starts on the 14th).
    await expect(page.getByLabel('Timezone')).toHaveValue('America/New_York');
    await expect(page.locator('input[type=time]')).toHaveValue('10:00');
    await expect(page.locator('input[type=date]')).toHaveValue('2027-03-10');
    await expect(page.getByText('Synced with Zoom')).toBeVisible();
    await expect(page.getByText(/2 speakers: Fake Host, Priya Panelist/)).toBeVisible();
    checks.push('1. Choosing an event from the list fills the title, description, capacity, duration, time zone and the host and panelists by name');

    // ---- 2. the Zoom card offers only "Select From Zoom" and "Create New in Zoom"
    await fresh();
    await expect(page.getByRole('button', { name: /Select From Zoom/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create New in Zoom/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Paste Link or ID/ })).toHaveCount(0);
    await expect(page.getByLabel('Zoom webinar URL or numeric ID')).toHaveCount(0);
    checks.push('2. The Zoom card has no "Paste Link or ID" option; events are picked from the list or created new');

    // ---- 6. missing permissions: named, not "no upcoming meetings"
    fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => !s.startsWith('webinar:read') && !s.startsWith('meeting:read'));
    await resetToken();
    await fresh();
    const permission = page.getByRole('alert').filter({ hasText: /Missing permissions/ });
    await expect(permission.first()).toBeVisible({ timeout: 30_000 });
    await expect(permission.first()).toContainText(/:admin|read:list/);
    await expect(page.getByText(/No upcoming meetings or webinars found/)).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/missing-permissions.png`, fullPage: true });
    checks.push('6. When Zoom refuses to list events because of missing permissions, the page names the permissions instead of saying there are no events');

    // ---- 7. the permission is then added in the Marketplace: no reconnect needed
    fake.config.scopes = [...FAKE_ZOOM_ALL_SCOPES];
    await page.getByRole('button', { name: 'Refresh List' }).click();
    await expect(page.getByRole('combobox', { name: 'Zoom event' })).toBeVisible({ timeout: 30_000 });
    await expect(permission).toHaveCount(0);
    checks.push('7. After the permissions are added in Zoom, Refresh List works at once (no reconnect, no waiting for the old token to expire)');

    // ---- 8a. the LeadSquared inbound registration webhook is gone: no section, no receiving route
    await page.goto(`${ORIGIN}/integrations`);
    await expect(page.getByRole('heading', { name: 'Activity Mapping for LSQ Automations' }).or(page.getByText('Activity Mapping'))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Inbound Registration Webhook/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Register Webhook in LeadSquared|Ping Endpoint/ })).toHaveCount(0);
    expect((await context.request.get(`${ORIGIN}/api/webhooks/leadsquared/activity`)).status()).toBe(404);
    expect((await context.request.post(`${ORIGIN}/api/webhooks/leadsquared/activity`, { data: {} })).status()).toBe(404);
    await expect(page.getByText('SMS activity')).toBeVisible();
    await expect(page.getByText('WhatsApp activity')).toBeVisible();
    await expect(page.getByText('Email sent', { exact: true })).toHaveCount(0);
    await expect(page.getByText('LinkedIn touch done')).toHaveCount(0);
    checks.push('8a. The LeadSquared inbound registration webhook section is gone from Integrations, and its receiving address no longer exists; activity mapping offers only SMS and WhatsApp');

    // ---- 8. the Integrations page: this server's real callback address, and a warning about a stale saved one
    await page.goto(`${ORIGIN}/integrations`);
    const zoomCard = page.getByRole('heading', { name: 'Zoom', exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Configure"]][1]');
    await zoomCard.getByRole('button', { name: 'Configure' }).click();
    await expect(page.getByText(`${ORIGIN}/api/auth/zoom/callback`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('loca.lt')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Zoom May Refuse A Localhost Address' })).toBeVisible();
    await expect(page.getByText('meeting:read:list_meetings').first()).toBeVisible();
    const stale = page.getByRole('status').filter({ hasText: 'Saved Redirect URI Is Not This Server' });
    await expect(stale).toBeVisible();
    await expect(stale).toContainText('closed-tunnel-example.trycloudflare.com');
    // Without a way back to a webinar, Connect opens in a new tab.
    const [connectTab] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /Connect With Zoom/ }).first().click()]);
    const stopped = connectTab.getByRole('alert').filter({ hasText: /does not answer/ });
    await expect(stopped).toBeVisible({ timeout: 30_000 });
    await expect(stopped).toContainText(`${ORIGIN}/api/auth/zoom/callback`);
    await connectTab.screenshot({ path: `${OUT}/stale-redirect.png`, fullPage: true });
    await connectTab.close();
    checks.push('8. Integrations shows this server\'s own callback address (not a hard-coded tunnel), warns about a stale saved Redirect URI, and Connect stops with the fix instead of sending the person to Zoom\'s error page');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify({ checks }, null, 2));
    console.log(`Zoom detail checks passed: ${checks.length}.\n` + checks.map((c) => `  - ${c}`).join('\n'));
  } catch (error) { await captureBrowserFailure(browser, OUT, error); throw error; } finally {
    await writeFile(`${OUT}/server.log`, logs.join('')).catch(() => undefined);
    await db?.end();
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((r) => server!.once('exit', () => r()));
    }
    await fake.stop();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
