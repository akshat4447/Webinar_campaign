import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check for importing a very large LeadSquared list through the real UI: the Fetch Contacts button,
// its staged progress, the final result, and what ends up in the database. Runs against a production build,
// a disposable database and the local fake LeadSquared server that enforces the documented limit of
// 25 calls per 5 seconds (nothing else is reachable).
//
//   npx tsx scripts/test-lsq-large-import.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-lsq-large-import.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect } from '@playwright/test';
import { startFakeLsq } from '../test-support/fakes/lsqFake';

const PORT = 3103;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/lsq-large-import';
const LEADS = Number(process.env.LEADS ?? 12_000);

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_lsq_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const fake = await startFakeLsq({ rateLimit: { limit: 25, windowMs: 5000 }, latencyMs: 80 });
  const ids: string[] = [];
  for (let i = 0; i < LEADS; i++) ids.push(fake.seedLead({ EmailAddress: `lead${i}@big.example`, FirstName: `Lead${i}`, LastName: 'Test', Company: `Co${i % 80}`, JobTitle: 'Director' }).id);
  const list = fake.seedList('Big Customer List', ids);

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'lsq-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'lsq-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', ZOOM_CLIENT_ID: '', ZOOM_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
    LSQ_API_BASE_URL: fake.url, LSQ_ACCESS_KEY: 'k', LSQ_SECRET_KEY: 's', LSQ_HOST: 'api.example.com',
    LSQ_IMPORT_SLICE_MS: '3000', // show the staged progress even on a fast machine
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
    await db.query(`INSERT INTO "Campaign" ("id","name","vertical","date","status","updatedAt") VALUES ('big-import','Big Import Webinar','Test','Future','draft',NOW())`);

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

    await page.goto(`${ORIGIN}/campaigns/new?id=big-import&step=1`);
    await page.getByRole('tab', { name: 'LeadSquared List' }).click();
    await expect(page.getByRole('combobox').filter({ hasText: /Big Customer List/ }).first()).toBeVisible({ timeout: 30_000 });
    const started = Date.now();
    await page.getByRole('button', { name: 'Fetch Contacts' }).click();

    // The progress is staged: it is seen at least once on the way, and the final result is the whole list.
    const progress = page.getByText(/Fetched [\d,]+ (of about [\d,]+ )?leads/);
    await expect(progress.first()).toBeVisible({ timeout: 60_000 });
    const seen = await progress.first().innerText();
    await expect(page.getByText(`${LEADS.toLocaleString()} contacts fetched from LeadSquared`)).toBeVisible({ timeout: 180_000 });
    const seconds = Math.round((Date.now() - started) / 1000);
    await page.screenshot({ path: `${OUT}/done.png`, fullPage: true });

    const count = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='big-import'`)).rows[0].count);
    const distinct = Number((await db.query(`SELECT count(DISTINCT lower("email")) FROM "Contact" WHERE "campaignId"='big-import'`)).rows[0].count);
    expect(count).toBe(LEADS);
    expect(distinct).toBe(LEADS);
    expect(fake.state.throttled, 'the app stayed under the 25-calls-per-5-seconds limit').toBe(0);
    expect(fake.requestsTo('AddLeadsToStaticList')).toHaveLength(0);
    expect(errors, 'Browser runtime errors').toEqual([]);
    const result = { leads: LEADS, stored: count, seconds, requests: fake.state.requestLog.length, throttled: fake.state.throttled, listId: list.id, progressSeen: seen };
    await writeFile(`${OUT}/results.json`, JSON.stringify(result, null, 2));
    console.log(`Large list import passed: ${JSON.stringify(result)}`);
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
