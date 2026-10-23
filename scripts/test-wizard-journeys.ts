import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser journeys for the wizard's autosave and resume (docs/WIZARD_AUTOSAVE_PLAN.md section 12).
//
// Everything runs against a production build of this app, a disposable database and the local fake Zoom
// server: nothing reaches a real provider (every non-local request is aborted), and the developer's own
// database is never touched.
//
//   npx tsx scripts/test-wizard-journeys.ts            builds into .next-journeys first
//   SKIP_BUILD=1 npx tsx scripts/test-wizard-journeys.ts   reuse an earlier build
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startFakeZoom } from '../test-support/fakes/zoomFake';

const PORT = 3101;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = '.next-journeys';
const OUT = 'artifacts/verification/wizard-journeys';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_wiz_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const fake = await startFakeZoom({});
  fake.seedMeeting({ topic: 'Fake Zoom Kickoff', start_time: new Date(Date.now() + 3 * 864e5).toISOString(), approval_type: 0 });

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'journey-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'journey-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false',
    ZOOM_AUTOSYNC: 'false',
    NEXT_DIST_DIR: DIST,
    APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', LSQ_ACCESS_KEY: '', LSQ_SECRET_KEY: '', LSQ_HOST: '', NETCORE_API_KEY: '',
    ZOOM_OAUTH_BASE_URL: fake.oauthUrl,
    ZOOM_API_BASE_URL: fake.apiUrl,
    ZOOM_CLIENT_ID: fake.config.clientId,
    ZOOM_CLIENT_SECRET: fake.config.clientSecret,
    LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
  });

  let db: Client | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const checks: string[] = [];
  const logs: string[] = [];
  const pageErrors: string[] = [];
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
      try { ready = (await fetch(ORIGIN)).ok; } catch { /* not up yet */ }
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error('Server did not start: ' + logs.join(''));

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await signIn(context, ORIGIN);
    // Only the app and the fake Zoom are reachable.
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) pageErrors.push(`console: ${m.text()}`); });

    const status = (p: Page) => p.locator('.lsq-draft-status__text');
    // The status text still reads "Saved" from the previous save for a moment after typing, so each save is
    // confirmed in the database; the label is checked separately once things settle.
    const waitSaved = async (p: Page) => {
      await p.waitForTimeout(1200);
      await expect(status(p)).toHaveText(/^Saved/, { timeout: 15_000 });
    };
    const campaignRow = async (id: string) => (await db!.query(`SELECT * FROM "Campaign" WHERE id=$1`, [id])).rows[0];
    const idOf = (p: Page) => new URL(p.url()).searchParams.get('id')!;
    const title = (p: Page) => p.getByLabel('Webinar title', { exact: false });

    // ---------------------------------------------------------------- 1. type, leave, come back
    await page.goto(`${ORIGIN}/campaigns/new`);
    await expect(title(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await db.query(`SELECT count(*) FROM "Campaign"`)).rows[0].count).toBe('0');
    checks.push('1a. Opening the wizard creates nothing');

    await title(page).fill('ab');
    await page.waitForTimeout(1800);
    expect((await db.query(`SELECT count(*) FROM "Campaign"`)).rows[0].count).toBe('0');
    checks.push('1b. Two characters of title still create nothing');

    await title(page).fill('Autosave Journey');
    await expect.poll(async () => (await db!.query(`SELECT name FROM "Campaign"`)).rows[0]?.name, { timeout: 15_000 }).toBe('Autosave Journey');
    await waitSaved(page);
    await expect(page).toHaveURL(/\/campaigns\/new\?id=[^&]+&step=0/);
    const id = idOf(page);
    expect((await campaignRow(id)).name).toBe('Autosave Journey');
    expect((await db.query(`SELECT count(*) FROM "Campaign"`)).rows[0].count).toBe('1');
    checks.push('1c. The draft is created as soon as the title has three characters, and the address bar follows');

    await page.getByLabel('Description').fill('Everything typed here should survive leaving the page.');
    await page.locator('input[type=date]').fill('2027-03-10');
    await page.locator('input[type=time]').fill('14:30');
    await waitSaved(page);
    await page.getByLabel('Seat capacity', { exact: false }).fill('250');
    await waitSaved(page);
    let row = await campaignRow(id);
    expect(row.description).toContain('survive leaving');
    expect(row.capacity).toBe(250);
    expect(row.scheduledAt).not.toBeNull();
    await expect(page.getByRole('heading', { name: 'Email Delivery' })).toHaveCount(0);
    await expect(page.getByText('LeadSquared CRM', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Registration Channels' })).toBeVisible();
    // The four channels Studio links itself are shown as fixed; only the four shared ones are choices.
    await expect(page.getByText('Added by Webinar Studio')).toBeVisible();
    const shared = page.getByRole('group', { name: /Shared by you/ });
    await expect(shared.getByRole('checkbox')).toHaveCount(4);
    await expect(shared.getByRole('checkbox', { name: /Email|SMS|WhatsApp/ })).toHaveCount(0);
    const website = shared.getByRole('checkbox', { name: /Website/ });
    await expect(website).toBeChecked();
    await website.uncheck();
    await waitSaved(page);
    const channelsSaved = String((await campaignRow(id)).selectedChannels).split(',');
    expect(channelsSaved).toEqual(expect.arrayContaining(['email_campaign', 'sms', 'whatsapp', 'linkedin']));
    expect(channelsSaved).not.toContain('website');
    await website.check();
    await waitSaved(page);
    expect(String((await campaignRow(id)).selectedChannels).split(',')).toContain('website');
    // The optional landing page: a wrong address is explained and never saved; a good one switches the mode; blank returns to 1-click.
    const landing = page.getByLabel('Custom landing page URL', { exact: false });
    await landing.fill('javascript:alert(1)');
    await expect(page.getByText(/Only http and https addresses are allowed/)).toBeVisible();
    await expect(page.getByText(/Required before continuing: .*valid landing page address/)).toBeVisible();
    await page.waitForTimeout(1500);
    let reg = await campaignRow(id);
    expect(reg.registrationLink).toBeNull();
    expect(reg.registrationMode).toBe('zoom');
    await landing.fill('https://pages.example.com/webinar');
    await expect(page.getByText(/Only http and https addresses are allowed/)).toHaveCount(0);
    await waitSaved(page);
    reg = await campaignRow(id);
    expect(reg.registrationLink).toBe('https://pages.example.com/webinar');
    expect(reg.registrationMode).toBe('external');
    await landing.fill('');
    await waitSaved(page);
    reg = await campaignRow(id);
    expect(reg.registrationLink).toBeNull();
    expect(reg.registrationMode).toBe('zoom');
    checks.push('1d2. The landing page address is checked as it is typed: a wrong one is explained and not saved, a good one switches to the custom page, and clearing it returns to 1-click registration');
    checks.push('1d. Description, date, time and capacity reach the database without pressing Continue');

    // Back out of the wizard through the sidebar, to Integrations, then return by the Draft shortcut.
    await page.getByRole('link', { name: 'Integrations' }).click();
    await expect(page).toHaveURL(/\/integrations/);
    await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible({ timeout: 15_000 });
    const shortcut = page.getByRole('link', { name: /Draft in progress/ });
    await expect(shortcut).toContainText('Autosave Journey', { timeout: 15_000 });
    await expect(shortcut).toContainText('Step 1 of 6');
    await shortcut.click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}&step=0`));
    await expect(title(page)).toHaveValue('Autosave Journey');
    await expect(page.getByLabel('Description')).toHaveValue(/survive leaving/);
    await expect(page.locator('input[type=date]')).toHaveValue('2027-03-10');
    await expect(page.locator('input[type=time]')).toHaveValue('14:30');
    await expect(page.getByLabel('Seat capacity', { exact: false })).toHaveValue('250');
    checks.push('1e. After visiting Integrations, the sidebar shortcut reopens the draft with every value filled in');

    // ---------------------------------------------------------------- 2. webinars list and overview resume
    await page.goto(`${ORIGIN}/`);
    const card = page.locator('article', { hasText: 'Autosave Journey' });
    const cont = card.getByRole('link', { name: /Continue Setup/ });
    await expect(cont).toContainText('Step 1 of 6');
    await expect(card.getByRole('img', { name: /Setup progress/ })).toBeVisible();
    await cont.click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}&step=0`));
    checks.push('2a. A draft card offers Continue Setup with its step and progress, and opens the wizard');

    await page.goto(`${ORIGIN}/campaigns/${id}/overview`);
    await expect(page.getByText('Setup Is Not Finished')).toBeVisible();
    expect(await page.getByRole('button', { name: 'Edit Setup' }).count()).toBe(0);
    await page.getByRole('link', { name: 'Continue Setup' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}`));
    await page.goto(`${ORIGIN}/campaigns/${id}/overview?edit=1`);
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}&step=0`));
    checks.push('2b. A draft Overview has no Edit Setup dialog: it points to the wizard, and the old ?edit=1 link lands there');

    // New Webinar asks before starting a second one.
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'New Webinar' }).click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('Autosave Journey');
    await ask.getByRole('button', { name: 'Continue Draft' }).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}&step=0`));
    await page.goto(`${ORIGIN}/`);
    await page.getByRole('button', { name: 'New Webinar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Start New' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/campaigns/new`);
    await expect(title(page)).toHaveValue('');
    checks.push('2c. New Webinar offers to continue the recent draft, and Start New still opens a blank wizard');

    // ---------------------------------------------------------------- 3. every step, refresh in the middle
    await page.goto(`${ORIGIN}/campaigns/new?id=${id}&step=0`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/step=1/);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/step=2/);
    row = await campaignRow(id);
    expect(row.wizardStep).toBe(2);
    expect(row.wizardFurthestStep).toBe(2);

    await page.getByRole('button', { name: 'Edit Criteria' }).click();
    await page.getByLabel('Scoring prompt or ICP role mandate').fill('Score VPs of Operations highest.');
    await waitSaved(page);
    expect((await campaignRow(id)).scoringPrompt).toBe('Score VPs of Operations highest.');
    checks.push('3a. The scoring prompt autosaves (it used to be lost unless scoring was run)');

    // Leave for the list and reopen from the draft card: lands on the step it was left on.
    await page.goto(`${ORIGIN}/`);
    await page.locator('article', { hasText: 'Autosave Journey' }).getByRole('link', { name: /Continue Setup/ }).click();
    await expect(page).toHaveURL(new RegExp(`id=${id}&step=2`));
    await page.getByRole('button', { name: 'Edit Criteria' }).click();
    await expect(page.getByLabel('Scoring prompt or ICP role mandate')).toHaveValue('Score VPs of Operations highest.');
    checks.push('3b. Reopening from the draft card resumes the step it was left on, with the edit intact');

    // On to messaging. Change the tone, refresh in the middle of the step.
    for (const next of [3, 4]) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`step=${next}`));
    }
    await expect(page.getByLabel('Tone of voice')).toBeVisible();
    await page.getByLabel('Tone of voice').selectOption('Consultative');
    await page.getByLabel('Instructions for Claude').fill('Lead with the operational problem.');
    await waitSaved(page);
    row = await campaignRow(id);
    expect(row.tone).toBe('Consultative');
    expect(row.aiInstructions).toBe('Lead with the operational problem.');
    await page.reload();
    await expect(page.getByLabel('Tone of voice')).toHaveValue('Consultative');
    await expect(page.getByLabel('Instructions for Claude')).toHaveValue('Lead with the operational problem.');
    checks.push('3c. Messaging settings survive a refresh in the middle of step 5 of 6');

    // The stepper reaches any step already visited, and not beyond.
    const stepper = page.getByRole('navigation', { name: 'Wizard progress' });
    await expect(stepper.getByRole('button', { name: /Details/ })).toBeEnabled();
    await expect(stepper.getByRole('button', { name: /Review/ })).toHaveCount(0);
    await stepper.getByRole('button', { name: /Scoring/ }).click();
    await expect(page).toHaveURL(/step=2/);
    await stepper.getByRole('button', { name: /Messaging/ }).click();
    await expect(page).toHaveURL(/step=4/);
    checks.push('3d. The stepper opens any step already reached, and later steps are not clickable');

    // ---------------------------------------------------------------- 4. network loss
    await page.goto(`${ORIGIN}/campaigns/new?id=${id}&step=2`);
    await page.getByRole('button', { name: 'Edit Criteria' }).click();
    await context.setOffline(true);
    await page.getByLabel('Scoring criteria or exclusion rules').fill('Exclude students and unverified contractors.');
    await expect(status(page)).toContainText(/Could not save|could not save/, { timeout: 30_000 });
    await expect(status(page)).toContainText('kept on this device', { timeout: 40_000 });
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect((await campaignRow(id)).scoringCriteria).not.toContain('Exclude students');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await waitSaved(page);
    expect((await campaignRow(id)).scoringCriteria).toBe('Exclude students and unverified contractors.');
    checks.push('4a. With the network down the status turns to a failure with Retry; after reconnecting, Retry saves everything');

    // Closing the tab with an edit the server has not confirmed: the unload post carries it to the server.
    await page.getByRole('button', { name: 'Edit Criteria' }).click().catch(() => undefined);
    await context.setOffline(true);
    await page.getByLabel('Scoring criteria or exclusion rules').fill('Closed with an unsaved edit.');
    await expect(status(page)).toContainText(/Could not save/, { timeout: 30_000 });
    expect((await campaignRow(id)).scoringCriteria).not.toContain('Closed with');
    await context.setOffline(false);
    await page.close();
    await expect.poll(async () => (await campaignRow(id)).scoringCriteria, { timeout: 15_000 }).toBe('Closed with an unsaved edit.');
    checks.push('4b. Closing the tab with an unsaved edit saves it through the unload post');

    // The unload post cannot get through either: only the device copy exists, and it is offered back. The
    // browser sends the post after the page is gone, so the loss is staged: take the device copy while the save
    // is failing, put the server back as it was, and bring the copy to a fresh page.
    const lost = await context.newPage();
    await lost.goto(`${ORIGIN}/campaigns/new?id=${id}&step=2`);
    await lost.getByRole('button', { name: 'Edit Criteria' }).click();
    await context.setOffline(true);
    await lost.getByLabel('Scoring criteria or exclusion rules').fill('Offline edit that never reached the server.');
    await expect(status(lost)).toContainText(/Could not save/, { timeout: 30_000 });
    const deviceCopy = await lost.evaluate((k) => window.localStorage.getItem(k), `wizard-draft:${id}`);
    expect(deviceCopy).toContain('Offline edit that never reached the server.');
    await context.setOffline(false);
    await lost.close();
    // The unload post lands after the page is gone; once it has, the server is put back as it was.
    await expect.poll(async () => (await campaignRow(id)).scoringCriteria, { timeout: 15_000 }).toBe('Offline edit that never reached the server.');
    await db.query(`UPDATE "Campaign" SET "scoringCriteria"='Closed with an unsaved edit.' WHERE id=$1`, [id]);
    const offlinePage = await context.newPage();
    await offlinePage.goto(`${ORIGIN}/campaigns/new`);
    await offlinePage.evaluate(([k, v]) => window.localStorage.setItem(k!, v!), [`wizard-draft:${id}`, deviceCopy]);
    await offlinePage.goto(`${ORIGIN}/campaigns/new?id=${id}&step=2`);
    const banner = offlinePage.getByRole('region', { name: 'Unsaved changes found' });
    await expect(banner).toBeVisible();
    expect((await campaignRow(id)).scoringCriteria).toBe('Closed with an unsaved edit.');
    await banner.getByRole('button', { name: 'Restore Unsaved Changes' }).click();
    await waitSaved(offlinePage);
    expect((await campaignRow(id)).scoringCriteria).toBe('Offline edit that never reached the server.');
    await expect(banner).toHaveCount(0);
    checks.push('4c. Edits that only reached this device are offered back on the next visit, restored, and then saved');

    // ---------------------------------------------------------------- 5. two tabs
    const a = offlinePage;
    await a.goto(`${ORIGIN}/campaigns/new?id=${id}&step=0`);
    const b = await context.newPage();
    await b.goto(`${ORIGIN}/campaigns/new?id=${id}&step=0`);
    await expect(title(a)).toHaveValue('Autosave Journey');
    await expect(title(b)).toHaveValue('Autosave Journey');

    await title(a).fill('Renamed In Tab A');
    await waitSaved(a);
    await b.getByLabel('Description').fill('Written in tab B.');
    await waitSaved(b);
    row = await campaignRow(id);
    expect(row.name).toBe('Renamed In Tab A');
    expect(row.description).toBe('Written in tab B.');
    await expect(b.getByRole('button', { name: 'Reload' }).first()).toBeVisible(); // told it is behind
    checks.push('5a. Two tabs editing different fields both keep their change, and the second is told it is behind');

    await title(b).fill('Renamed In Tab B');
    const conflict = b.getByRole('alert').filter({ hasText: 'changed in another tab' });
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    expect((await campaignRow(id)).name).toBe('Renamed In Tab A');
    await conflict.getByRole('button', { name: 'Keep Mine' }).click();
    await waitSaved(b);
    expect((await campaignRow(id)).name).toBe('Renamed In Tab B');
    checks.push('5b. Editing the same field from a stale tab shows a conflict instead of overwriting; Keep Mine then saves');

    await title(a).fill('Tab A Again');
    const conflictA = a.getByRole('alert').filter({ hasText: 'changed in another tab' });
    await expect(conflictA).toBeVisible({ timeout: 15_000 });
    await conflictA.getByRole('button', { name: 'Reload' }).click();
    await expect(title(a)).toHaveValue('Renamed In Tab B');
    checks.push('5c. Reload adopts the newer copy');
    await b.close();

    // ---------------------------------------------------------------- 6. Integrations round trip (fake Zoom)
    await a.goto(`${ORIGIN}/campaigns/new?id=${id}&step=0`);
    await title(a).fill('Round Trip Webinar');
    await waitSaved(a);
    await a.getByRole('link', { name: 'Manage Zoom Connection' }).click();
    await expect(a).toHaveURL(/\/integrations\?returnTo=/);
    const bar = a.getByRole('region', { name: 'Return to webinar setup' });
    await expect(bar).toContainText('Setting Up Round Trip Webinar');
    await expect(bar).toContainText('step 1 of 6');
    checks.push('6a. Integrations opened from the wizard shows a way back to the webinar and step');

    const zoomCard = a.getByRole('heading', { name: 'Zoom', exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Configure"]][1]');
    await zoomCard.getByRole('button', { name: 'Configure' }).click();
    const connect = a.getByRole('link', { name: /Connect With Zoom/ });
    await expect(connect).toHaveAttribute('href', /returnTo=%2Fcampaigns%2Fnew%3Fid%3D/);
    expect(await connect.getAttribute('target')).toBeNull();
    await connect.click();
    await expect(a).toHaveURL(new RegExp(`/campaigns/new\\?id=${id}&step=0`), { timeout: 20_000 });
    await expect(title(a)).toHaveValue('Round Trip Webinar');
    await expect(a.getByText(/Connected as/).first()).toBeVisible();
    await expect(a.getByRole('combobox', { name: 'Zoom event' })).toBeVisible({ timeout: 15_000 });
    await expect(a.getByRole('option', { name: /Fake Zoom Kickoff/ })).toHaveCount(1);
    expect(new URL(a.url()).searchParams.get('connected')).toBeNull();
    checks.push('6b. Connecting Zoom from the wizard returns to the same step with the values filled in, the result shown once, and the meeting list loaded');

    // A tampered returnTo is never followed.
    for (const bad of ['https://evil.example/x', '//evil.example', '/integrations', 'javascript:alert(1)']) {
      const res = await a.request.get(`${ORIGIN}/api/auth/zoom/connect?returnTo=${encodeURIComponent(bad)}`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      const stored = await db.query(`SELECT value FROM "AppSetting" WHERE key LIKE 'zoom.oauth_return.%'`);
      expect(stored.rowCount).toBe(0);
    }
    await a.goto(`${ORIGIN}/integrations?returnTo=${encodeURIComponent('https://evil.example')}`);
    await expect(a.getByRole('region', { name: 'Return to webinar setup' })).toHaveCount(0);
    checks.push('6c. A return address that is not a same-site webinar path is ignored everywhere');

    // ---------------------------------------------------------------- 6d. races between autosave and navigation
    const countNamed = async (n: string) => Number((await db!.query(`SELECT count(*) FROM "Campaign" WHERE name=$1`, [n])).rows[0].count);

    // Continue pressed straight after typing, before the pause that triggers autosave: one draft, not two.
    await a.goto(`${ORIGIN}/campaigns/new`);
    await title(a).fill('Fast Continue');
    await a.locator('input[type=date]').fill('2027-05-05');
    await a.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(a).toHaveURL(/step=1/, { timeout: 20_000 });
    await a.waitForTimeout(2500);
    expect(await countNamed('Fast Continue')).toBe(1);
    const fastId = idOf(a);
    await a.goto(`${ORIGIN}/campaigns/new?id=${fastId}&step=0`);
    await a.getByLabel('Description').fill('Edited after a fast Continue.');
    await expect.poll(async () => (await db!.query(`SELECT description FROM "Campaign" WHERE id=$1`, [fastId])).rows[0].description, { timeout: 15_000 }).toBe('Edited after a fast Continue.');
    expect(await countNamed('Fast Continue')).toBe(1);
    checks.push('6d. Pressing Continue straight after typing makes one draft, and later autosaves go to it');

    // Leaving the wizard within the typing pause must not pull the person back when the draft is created.
    await a.goto(`${ORIGIN}/campaigns/new`);
    await title(a).fill('Leaving Quickly');
    await a.getByRole('link', { name: 'Integrations' }).click();
    await expect(a).toHaveURL(/\/integrations/);
    await a.waitForTimeout(3000);
    await expect(a).toHaveURL(/\/integrations/);
    expect(await countNamed('Leaving Quickly')).toBe(1);
    // The copy kept on the device before the draft existed must not come back as an offer to create it twice.
    await a.goto(`${ORIGIN}/campaigns/new`);
    await a.waitForTimeout(1500);
    await expect(a.getByRole('region', { name: 'Unsaved changes found' })).toHaveCount(0);
    checks.push('6e. Leaving within the typing pause still saves the draft, does not drag the person back, and a fresh wizard does not offer to create it again');

    // Back and forward show the current draft, not a cached older copy.
    await a.goto(`${ORIGIN}/campaigns/new?id=${fastId}&step=0`);
    // Typing before the page has hydrated is overwritten or merged with the saved text, which is a test race, not an app fault.
    await a.waitForLoadState('networkidle');
    await expect(a.getByLabel('Description')).toHaveValue('Edited after a fast Continue.');
    await a.getByLabel('Description').fill('Latest text before leaving.');
    await expect.poll(async () => (await db!.query(`SELECT description FROM "Campaign" WHERE id=$1`, [fastId])).rows[0].description, { timeout: 15_000 }).toBe('Latest text before leaving.');
    await a.goto(`${ORIGIN}/`);
    await a.goBack();
    await expect(a.getByLabel('Description')).toHaveValue('Latest text before leaving.');
    checks.push('6f. Returning with the browser Back button shows the latest saved values');

    // ---------------------------------------------------------------- 7. launched webinar
    await db.query(`UPDATE "Campaign" SET status='live', "cadenceStatus"='running' WHERE id=$1`, [id]);
    await a.goto(`${ORIGIN}/campaigns/new?id=${id}&step=0`);
    await expect(a).toHaveURL(new RegExp(`/campaigns/${id}/overview`));
    const before = (await campaignRow(id)).name;
    const res = await a.request.post(`${ORIGIN}/api/wizard/draft`, { data: { campaignId: id, step: 0, patch: { title: 'Sneaky' }, baseRevision: 0 }, headers: { 'sec-fetch-site': 'same-origin' } });
    expect((await res.json()).status).toBe('locked');
    expect((await campaignRow(id)).name).toBe(before);
    checks.push('7. A launched webinar no longer opens the wizard, and autosave to it is refused');

    // ---------------------------------------------------------------- 8. beacon route and sealed inputs
    const forbidden = await a.request.post(`${ORIGIN}/api/wizard/draft`, { data: { campaignId: null, step: 0, patch: { title: 'Cross Site' } }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
    expect(forbidden.status()).toBe(403);
    const noHeaders = await a.request.post(`${ORIGIN}/api/wizard/draft`, { data: { campaignId: null, step: 0, patch: { title: 'No Origin' } } });
    expect([200, 403]).toContain(noHeaders.status());
    const bad = await a.request.post(`${ORIGIN}/api/wizard/draft`, { data: 'not json', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' } });
    expect(bad.status()).toBe(400);
    const big = await a.request.post(`${ORIGIN}/api/wizard/draft`, { data: JSON.stringify({ patch: { description: 'x'.repeat(300_000) } }), headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });
    expect(big.status()).toBe(413);
    expect((await db.query(`SELECT count(*) FROM "Campaign" WHERE name IN ('Cross Site','Sneaky')`)).rows[0].count).toBe('0');
    checks.push('8. The unload beacon route refuses cross-site posts, bad bodies and oversized bodies');

    // ---------------------------------------------------------------- 9. layout and accessibility
    const violations: unknown[] = [];
    await db.query(`UPDATE "Campaign" SET status='draft', "cadenceStatus"='not_started' WHERE id=$1`, [id]);
    for (const width of [1440, 390]) {
      await a.setViewportSize({ width, height: 1000 });
      for (const path of [`/campaigns/new?id=${id}&step=0`, `/campaigns/new?id=${id}&step=4`, '/', `/campaigns/${id}/overview`, `/integrations?returnTo=${encodeURIComponent(`/campaigns/new?id=${id}&step=2`)}`]) {
        await a.goto(ORIGIN + path);
        await a.locator('main').first().waitFor();
        await a.waitForLoadState('networkidle');
        expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px overflow: ${path}`).toBe(true);
        const result = await new AxeBuilder({ page: a }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        for (const v of result.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) violations.push({ path, width, id: v.id, nodes: v.nodes.map((n) => n.target) });
        await a.screenshot({ path: `${OUT}/${width}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`, fullPage: true });
      }
    }
    expect(violations, 'Serious or critical accessibility violations').toEqual([]);
    checks.push('9. Wizard, list, overview and Integrations have no horizontal overflow at 1440 and 390 px and no serious accessibility violations');

    expect(pageErrors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify({ checks, pageErrors }, null, 2));
    console.log(`Wizard journeys passed: ${checks.length} checks.\n` + checks.map((c) => `  - ${c}`).join('\n'));
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
