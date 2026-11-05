import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check that the LeadSquared suppression and exclusion lists picked on the wizard are saved by themselves, without pressing
// Save: a list picked and then left behind used to be lost silently, so the people on it were still emailed. Production build,
// disposable database, fake LeadSquared.
//
//   npx tsx scripts/test-suppression-lists.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-suppression-lists.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect } from '@playwright/test';
import { startFakeLsq } from '../test-support/fakes/lsqFake';

const PORT = 3105;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/suppression-lists';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_lsq_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const fake = await startFakeLsq({  });
  const mk = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => fake.seedLead({ EmailAddress: `${prefix}${i}@${prefix}.example`, FirstName: `${prefix.toUpperCase()}${i}`, LastName: 'Test', Company: 'Acme', JobTitle: 'Director' }).id);
  fake.seedList('Registrants List', mk('a', 2));
  fake.seedList('Competitors', mk('b', 2));
  fake.seedList('Do Not Contact', mk('c', 1));

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'lsq-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'lsq-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', ZOOM_CLIENT_ID: '', ZOOM_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
    LSQ_API_BASE_URL: fake.url, LSQ_ACCESS_KEY: 'k', LSQ_SECRET_KEY: 's', LSQ_HOST: 'api.example.com',
  });
  let db: Client | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  await mkdir(OUT, { recursive: true });
  try {
    if (spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' }).status) throw new Error('Migrations failed.');
    if (!process.env.SKIP_BUILD && spawnSync('npm', ['run', 'build', '--', '--webpack'], { env, stdio: 'inherit' }).status) throw new Error('Build failed.');
    db = new Client({ connectionString: target.toString() });
    await db.connect();
    await db.query(`INSERT INTO "Campaign" ("id","name","vertical","date","status","updatedAt") VALUES ('imp','Import Lists Webinar','Test','Future','draft',NOW())`);

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
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const row = async () => (await db!.query(`SELECT "lsqSuppressionListId" AS sup, "lsqExclusionListIds" AS excl FROM "Campaign" WHERE id='imp'`)).rows[0] as { sup: string | null; excl: string | null };
    const checks: string[] = [];
    const ok = (s: string) => { checks.push(s); console.log('  ok', s); };
    const exclusionBox = (name: string) => page.locator('label', { hasText: name }).locator('input[type=checkbox]').first();

    await page.goto(`${ORIGIN}/campaigns/new?id=imp&step=2`);
    await expect(page.getByText('Additional Exclusion Lists')).toBeVisible({ timeout: 60_000 });
    await expect(exclusionBox('Competitors')).toBeVisible({ timeout: 60_000 });
    expect((await row()).excl).toBeNull();

    // 1. Tick an exclusion list and do nothing else: no Save pressed, and it still reaches the database.
    await exclusionBox('Competitors').check();
    await expect.poll(async () => (await row()).excl, { timeout: 20_000 }).toMatch(/\[".+"\]/);
    ok('1. A picked exclusion list is saved by itself, without pressing Save');

    // 2. And it is still ticked after a reload.
    await page.reload();
    await expect(exclusionBox('Competitors')).toBeChecked({ timeout: 60_000 });
    ok('2. It is still ticked after the page is reloaded');

    // 3. The suppression list is saved the same way.
    await page.getByLabel('Suppression list', { exact: true }).selectOption({ label: 'Registrants List (2 members)' });
    await expect.poll(async () => (await row()).sup, { timeout: 20_000 }).not.toBeNull();
    ok('3. A picked suppression list is saved by itself');

    // 4. Two quick changes in a row end up as the last one, not an earlier one finishing late.
    const beforeQuick = (await row()).excl;
    await exclusionBox('Do Not Contact').check();
    await exclusionBox('Competitors').uncheck();
    await expect.poll(async () => (await row()).excl, { timeout: 20_000 }).not.toBe(beforeQuick);
    await page.waitForTimeout(2500);
    const afterQuick = JSON.parse((await row()).excl as string) as string[];
    expect(afterQuick).toHaveLength(1);
    expect(afterQuick).not.toEqual(JSON.parse(beforeQuick as string));
    await page.reload();
    await expect(exclusionBox('Do Not Contact')).toBeChecked({ timeout: 60_000 });
    await expect(exclusionBox('Competitors')).not.toBeChecked();
    ok('4. Quick changes in a row settle on the last one, and it survives a reload');

    // 5. Leaving the page right after a change still saves it.
    await exclusionBox('Competitors').check();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect.poll(async () => JSON.parse((await row()).excl ?? '[]').length, { timeout: 20_000 }).toBe(2);
    ok('5. Moving on straight after picking a list still saves it');

    // 6. The Save button still works and changes nothing it should not.
    await page.goto(`${ORIGIN}/campaigns/new?id=imp&step=2`);
    await expect(exclusionBox('Competitors')).toBeChecked({ timeout: 60_000 });
    const before = await row();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('LeadSquared suppression and exclusion lists updated.')).toBeVisible({ timeout: 20_000 });
    expect(await row()).toEqual(before);
    ok('6. The Save button still works');

    // 7. Clearing the lists is saved too, so an exclusion can be taken off as well as put on.
    await page.getByRole('button', { name: 'Clear All' }).click();
    await expect.poll(async () => (await row()).excl, { timeout: 20_000 }).toBe('[]');
    ok('7. Clearing the exclusion lists is saved');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await page.screenshot({ path: `${OUT}/done.png`, fullPage: true });
    console.log(`Suppression list checks passed: ${checks.length}.\n${checks.map((c) => `  - ${c}`).join('\n')}`);
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
