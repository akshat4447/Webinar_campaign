import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check for choosing a second list or file on the wizard's Audience step: the contacts of the list picked
// last are the audience (not both lists), "keep and add" merges instead, scored work asks first, and what ends up in
// the database matches what the screen said. Production build, disposable database, fake LeadSquared.
//
//   npx tsx scripts/test-import-lists.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-import-lists.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect } from '@playwright/test';
import { startFakeLsq } from '../test-support/fakes/lsqFake';

const PORT = 3104;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/import-lists';

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
  fake.seedList('List Alpha', mk('a', 3));
  fake.seedList('List Beta', mk('b', 2));

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

    const emails = async () => (await db!.query(`SELECT "email" FROM "Contact" WHERE "campaignId"='imp' ORDER BY "email"`)).rows.map((r) => r.email as string);
    const pick = async (label: RegExp) => {
      const sel = page.getByLabel('Source list');
      // The lists arrive after the select appears; choosing before they do would be undone when they load.
      await expect(sel.locator('option').filter({ hasText: label })).toHaveCount(1, { timeout: 30_000 });
      await sel.selectOption({ label: (await sel.locator('option').allInnerTexts()).find((t) => label.test(t)) as string });
    };
    const fetchNow = () => page.getByRole('button', { name: 'Fetch Contacts' }).click();
    const checks: string[] = [];
    const ok = (s: string) => { checks.push(s); console.log('  ok', s); };

    await page.goto(`${ORIGIN}/campaigns/new?id=imp&step=1`);
    await page.getByRole('tab', { name: 'LeadSquared List' }).click();
    await expect(page.getByLabel('Source list')).toBeVisible({ timeout: 30_000 });

    // 1. First list: three contacts, and nothing to replace yet, so no choice is offered.
    await expect(page.getByText(/already imported and add these to them/)).toHaveCount(0);
    await pick(/List Alpha/);
    await fetchNow();
    await expect(page.getByText('3 contacts fetched from LeadSquared')).toBeVisible({ timeout: 60_000 });
    expect(await emails()).toEqual(['a0@a.example', 'a1@a.example', 'a2@a.example']);
    ok('1. The first list brings in its three contacts');

    // 2. Picking the second list uses that list alone: the first list's contacts are gone, the screen says so.
    await expect(page.getByText(/Keep the 3 contacts already imported and add these to them/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Importing replaces the 3 contacts already imported, so only the file or list you pick is used/)).toBeVisible();
    await pick(/List Beta/);
    await fetchNow();
    await expect(page.getByText('2 contacts fetched from LeadSquared')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Replaced the 3 contacts imported before/)).toBeVisible();
    expect(await emails()).toEqual(['b0@b.example', 'b1@b.example']);
    ok('2. Picking another list replaces the first: only the second list is the audience, and the screen says what was replaced');

    // 3. Ticking "keep and add" merges the other list in.
    await expect(page.getByText(/Keep the 2 contacts already imported/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('checkbox', { name: /already imported and add these to them/ }).check();
    await expect(page.getByText(/merged in by email/)).toBeVisible();
    await pick(/List Alpha/);
    await fetchNow();
    await expect(page.getByText('3 contacts fetched from LeadSquared')).toBeVisible({ timeout: 60_000 });
    await expect.poll(emails, { timeout: 15_000 }).toHaveLength(5);
    ok('3. "Keep and add" merges the two lists: five contacts');

    // 4. Scored work is not thrown away on one click: Cancel leaves everything, Replace uses the new list alone.
    await db.query(`UPDATE "Contact" SET "score"=88, "approved"=true WHERE "campaignId"='imp' AND "email"='a0@a.example'`);
    await page.reload();
    await page.getByRole('tab', { name: 'LeadSquared List' }).click();
    await expect(page.getByLabel('Source list')).toBeVisible({ timeout: 30_000 });
    await pick(/List Beta/);
    await fetchNow();
    await expect(page.getByText('Replace All Imported Contacts?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await emails()).toHaveLength(5);
    ok('4a. With scored contacts a replace asks first, and Cancel changes nothing');
    await fetchNow();
    await page.getByRole('button', { name: 'Replace Contacts' }).click();
    await expect(page.getByText('2 contacts fetched from LeadSquared')).toBeVisible({ timeout: 60_000 });
    expect(await emails()).toEqual(['b0@b.example', 'b1@b.example']);
    ok('4b. Confirming the replace leaves only the list picked last');

    // 5. A file replaces the contacts too.
    await page.getByRole('tab', { name: 'Upload CSV' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Email,Company,Title\nCara,cara@c.example,Acme,VP\n') });
    await expect(page.getByText(/1 contact imported/).first()).toBeVisible({ timeout: 60_000 });
    expect(await emails()).toEqual(['cara@c.example']);
    ok('5. Uploading a file replaces the earlier contacts as well');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await page.screenshot({ path: `${OUT}/done.png`, fullPage: true });
    console.log(`Import list checks passed: ${checks.length}.\n${checks.map((c) => `  - ${c}`).join('\n')}`);
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
