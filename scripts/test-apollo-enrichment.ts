import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check of Apollo enrichment through the real UI: "Select Fields and Run Enrichment", then
// "Enrich All Contacts". Runs against a production build, a disposable database and the local fake Apollo
// (paid-plan limits: 1,000 enrichment requests a minute). Nothing else is reachable and no credits are used.
//
//   npx tsx scripts/test-apollo-enrichment.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-apollo-enrichment.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect, type Page } from '@playwright/test';
import { startFakeApollo } from '../test-support/fakes/apolloFake';

const PORT = 3104;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/apollo-enrichment';
const CONTACTS = Number(process.env.CONTACTS ?? 800);

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_apollo_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;
  const fake = await startFakeApollo({ perMinute: 1000, latencyMs: 40 });
  for (let i = 0; i < CONTACTS; i++) fake.seed({ first_name: `Ada${i}`, last_name: `Lovelace${i}`, organization: 'Analytical Engines', domain: 'analytical.example.org', title: 'Chief Engineer', email: `ada${i}@analytical.example.org` });

  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'apollo-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'apollo-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: '', ZOOM_CLIENT_ID: '', ZOOM_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
    APOLLO_API_BASE_URL: fake.apiUrl, APOLLO_API_KEY: 'test-key',
  });
  let db: Client | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  await mkdir(OUT, { recursive: true });

  const seedCampaign = async (id: string) => {
    await db!.query(`DELETE FROM "Campaign" WHERE id=$1`, [id]);
    await db!.query(`INSERT INTO "Campaign" ("id","name","vertical","date","status","updatedAt") VALUES ($1,'Apollo Webinar','Test','Future','draft',NOW())`, [id]);
    await db!.query(
      `INSERT INTO "Contact" ("id","campaignId","name","email","account","vertical","title","function","seniority")
       SELECT $1 || '-' || g, $1, 'Ada' || g || ' Lovelace' || g, NULL, 'Analytical Engines', 'x', 'Director', 'x', 'x' FROM generate_series(0, $2::int - 1) g`,
      [id, CONTACTS],
    );
  };
  const runFromUi = async (page: Page, id: string) => {
    await page.goto(`${ORIGIN}/campaigns/new?id=${id}&step=2`);
    await page.getByRole('button', { name: /Select Fields and (Re-)?Run Enrichment/ }).click();
    // No Claude key in this environment, so only the Apollo fields are enriched here.
    await page.getByRole('checkbox', { name: /Persona and seniority normalization/ }).uncheck();
    await expect(page.getByText(/About \d+ matches?/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Enrich All Contacts' }).click();
  };

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
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const results: Record<string, unknown> = {};

    // ---- 1. paid plan: one click enriches the whole audience
    await seedCampaign('apollo-paid');
    await runFromUi(page, 'apollo-paid');
    const started = Date.now();
    let progressSeen = '';
    const progress = page.getByRole('button', { name: /Enriching [\d,]+ of [\d,]+/ });
    void progress.first().waitFor({ timeout: 20_000 }).then(async () => { progressSeen = await progress.first().innerText(); }).catch(() => undefined);
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 240_000 });
    const seconds = Math.round((Date.now() - started) / 1000);
    await page.screenshot({ path: `${OUT}/paid-done.png`, fullPage: true });
    const enriched = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='apollo-paid' AND "email" LIKE 'ada%@analytical.example.org'`)).rows[0].count);
    const verified = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='apollo-paid' AND "emailVerified"=true AND "emailSimulated"=false`)).rows[0].count);
    const titled = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='apollo-paid' AND "enrichedAt" IS NOT NULL`)).rows[0].count);
    expect(enriched).toBe(CONTACTS);
    expect(verified).toBe(CONTACTS);
    expect(titled).toBe(CONTACTS);
    const bulkCalls = fake.requests.filter((r) => r.path.endsWith('/bulk_match') && r.status === 200).length;
    expect(bulkCalls).toBe(Math.ceil(CONTACTS / 10));
    expect(fake.throttled).toBe(0);
    await expect(page.getByText(`Enriched${CONTACTS.toLocaleString()}`.replace('Enriched', '')).first()).toBeVisible();
    results.paid = { contacts: CONTACTS, enriched, seconds, requests: bulkCalls, progressSeen };

    // ---- 2. Apollo cuts the run short with a long rate limit: the page says so, the rest is untouched
    fake.reset();
    for (let i = 0; i < CONTACTS; i++) fake.seed({ first_name: `Ada${i}`, last_name: `Lovelace${i}`, organization: 'Analytical Engines', domain: 'analytical.example.org', title: 'Chief Engineer', email: `ada${i}@analytical.example.org` });
    fake.setOptions({ total: 3, retryAfterSec: 3600 });
    await seedCampaign('apollo-limited');
    await runFromUi(page, 'apollo-limited');
    await expect(page.getByRole('alert').filter({ hasText: /rate limit/i })).toBeVisible({ timeout: 120_000 });
    const limitedText = await page.getByRole('alert').filter({ hasText: /rate limit/i }).first().innerText();
    await page.screenshot({ path: `${OUT}/limited.png`, fullPage: true });
    const got = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='apollo-limited' AND "email" IS NOT NULL`)).rows[0].count);
    const guessed = Number((await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='apollo-limited' AND "emailSimulated"=true`)).rows[0].count);
    expect(got).toBe(30); // three requests of ten were answered before the limit
    expect(guessed).toBe(0);
    const job = (await db.query(`SELECT status, cursor, total FROM "OperationJob" WHERE "campaignId"='apollo-limited'`)).rows[0];
    expect(job).toMatchObject({ status: 'failed', cursor: 30, total: CONTACTS });
    results.limited = { enriched: got, guessed, job, shown: limitedText.slice(0, 200) };

    expect(errors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    console.log(`Apollo enrichment UI passed: ${JSON.stringify(results)}`);
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
