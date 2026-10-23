import { captureBrowserFailure } from '../test-support/browserEvidence';
import { isolatedServerEnv } from '../test-support/isolatedEnv';
// Browser check of the webinar workspace after launch: the Overview and Messaging tabs of a webinar whose date has
// passed, with one step already sent and another still queued. It guards the screens people look at most:
// nothing repeated, nothing that does not apply to a sent step, nothing that claims a number it does not have.
// Runs against a production build and a disposable database.
//
//   npx tsx scripts/test-workspace-screens.ts          (builds into .next-journeys first)
//   SKIP_BUILD=1 npx tsx scripts/test-workspace-screens.ts
import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_LOGIN_ENV, signIn } from './testSignIn';
import { chromium, expect } from '@playwright/test';
import { startFakeLsq } from '../test-support/fakes/lsqFake';

const PORT = 3109;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/verification/workspace-screens';

async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const name = `webinar_test_workspace_${randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = '/' + name;

  const lsq = await startFakeLsq({ accessKey: 'AK', secretKey: 'SK' });
  const env = isolatedServerEnv({
    PORT: String(PORT), HOSTNAME: '127.0.0.1',
    ...TEST_LOGIN_ENV,
    DATABASE_URL: target.toString(),
    REGISTRATION_SECRET: 'workspace-registration-secret-with-32-plus-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'workspace-encryption-key-with-32-plus-characters',
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false', NEXT_DIST_DIR: '.next-journeys', APP_ORIGIN: ORIGIN,
    ANTHROPIC_API_KEY: '', NETCORE_API_KEY: 'nc-test-key', NETCORE_FROM_EMAIL: 'events@example.com', LSQ_ACCESS_KEY: 'AK', LSQ_SECRET_KEY: 'SK', LSQ_HOST: 'fake.example.com', LSQ_API_BASE_URL: lsq.url, LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
  });
  let server: ReturnType<typeof spawn> | undefined;
  let check: Client | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const logs: string[] = [];
  const checks: string[] = [];
  await mkdir(OUT, { recursive: true });
  try {
    if (spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' }).status) throw new Error('Migrations failed.');
    if (!process.env.SKIP_BUILD && spawnSync('npm', ['run', 'build', '--', '--webpack'], { env, stdio: 'inherit' }).status) throw new Error('Build failed.');

    // ---- seed: a launched webinar, three days past its date, one step sent and one queued
    process.env.DATABASE_URL = target.toString();
    // The seed below runs in this process: it must not reach a real LeadSquared if the shell has credentials.
    delete process.env.LSQ_ACCESS_KEY; delete process.env.LSQ_SECRET_KEY; delete process.env.LSQ_HOST;
    const { db } = await import('@/lib/db');
    const { provisionCampaignDefaults } = await import('@/lib/campaignDefaults');
    const link = 'https://zoom.example/j/99460613345';
    for (const [key, label] of [['invite', 'Initial invite'], ['nudge', 'Nudge']] as const) {
      await db.messageTemplate.create({ data: { campaignId: null, channel: 'email', key, name: label, hasSubject: true, subject: 'Join {{topic}}', body: 'Hi {{firstName}}, join us for {{topic}}: {{link}}', status: 'ready' } });
    }
    for (const [key, label] of [['linkedin', 'LinkedIn touch'], ['t1d', 'T-1 day reminder']] as const) {
      await db.messageTemplate.create({ data: { campaignId: null, channel: 'linkedin', key, name: label, hasSubject: false, subject: null, body: 'Hi {{firstName}}, join us for {{topic}}: {{link}}', status: 'ready' } });
    }
    const campaign = await db.campaign.create({
      data: {
        name: 'Workspace Screens Webinar', vertical: 'Unassigned', date: 'x', description: 'A launched webinar.', status: 'live', cadenceStatus: 'stopped',
        scheduledAt: new Date(Date.now() - 3 * 864e5), registrationMode: 'zoom', zoomMeetingId: '99460613345', zoomLink: link, capacity: 150,
        selectedChannels: 'email_campaign,whatsapp,linkedin,sdr_sales,third_parties,linkedin_event,website', // saved before SMS was one of them
        scoringThreshold: 70, scoringCriteria: 'VP/Director+ in Marketing, Ops, or Admissions; account verticals in lending, healthcare or education; verified email on file.',
      },
    });
    const campaignId = campaign.id;
    await provisionCampaignDefaults(campaignId);
    await db.cadenceStep.updateMany({ where: { campaignId, key: { notIn: ['invite', 'nudge', 'linkedin', 't1d'] } }, data: { enabled: false } });
    await db.cadenceStep.updateMany({ where: { campaignId, key: { in: ['invite', 'nudge', 'linkedin', 't1d'] } }, data: { enabled: true } });
    const personas = [
      ['VP Marketing', 'Marketing', 'VP'], ['Director Operations', 'Operations', 'Director'], ['Head Admissions', 'Admissions', 'Head'],
      ['CXO', 'Other', 'CXO'], ['Manager Marketing', 'Marketing', 'Manager'], ['IC Analyst', 'Other', 'IC'],
    ];
    const people: string[] = [];
    for (const [i, [title, fn, seniority]] of personas.entries()) {
      const c = await db.contact.create({ data: { campaignId, name: `Person ${i + 1}`, email: `p${i + 1}@example.com`, account: `Account ${i + 1}`, vertical: 'Test', title, function: fn, seniority, approved: i < 3, score: 90 - i * 10, explanation: `Scored ${90 - i * 10}: ${seniority} in ${fn}.` } });
      people.push(c.id);
    }
    for (const id of people.slice(0, 3)) {
      // The copy that went out: valid, but written against a link the webinar no longer uses (it would read "Old Link" if still pending).
      await db.personalizedMessage.create({ data: { campaignId, contactId: id, stepKey: 'invite', channel: 'email', subject: 'Invite: a live session', body: `Hi there,\n\nSave your seat: ${link}\n\nSee you there.`, linkUsed: 'https://old.example/j/1', status: 'reviewed' } });
      await db.cadenceSend.create({ data: { campaignId, contactId: id, stepKey: 'invite', dueAt: new Date(Date.now() - 4 * 864e5), status: 'sent', sentAt: new Date(Date.now() - 4 * 864e5) } });
      // The next step is still waiting, with copy that fails validation (no body).
      await db.personalizedMessage.create({ data: { campaignId, contactId: id, stepKey: 'nudge', channel: 'email', subject: '', body: '' } });
      await db.cadenceSend.create({ data: { campaignId, contactId: id, stepKey: 'nudge', dueAt: new Date(Date.now() - 1 * 864e5), status: 'queued' } });
    }
    // Two people registered (one through email, one through SMS); a failed CRM sync; a log with every kind of entry; and a Zoom
    // connection that stopped working.
    await db.contact.update({ where: { id: people[0] }, data: { registeredAt: new Date(Date.now() - 5 * 864e5), registrationSource: 'email' } });
    await db.contact.update({ where: { id: people[1] }, data: { registeredAt: new Date(Date.now() - 5 * 864e5), registrationSource: 'sms' } });
    await db.attentionItem.create({ data: { campaignId, icon: 'ErrorProperty1Outline', color: 'error', title: 'LeadSquared lead sync failed', detail: '3 contacts (Person 1, Person 2, Person 3): MXUnknownAttributeException Attribute(s) does not exist - mx_Seniority,mx_Function. LeadSquared has no field named mx_Seniority,mx_Function.', actionsCsv: 'retry' } });
    for (const [text, dot] of [['Webinar created', 'var(--accent-500)'], ['Launched cadence: 6 sends queued', 'var(--success-500)'], ['LeadSquared sync failed: Attribute(s) does not exist', 'var(--warning-700)'], ['1 contact has no usable email — queued for Apollo enrichment', 'var(--warning-700)']] as const) {
      await db.activityLogEntry.create({ data: { campaignId, text, dot } });
    }
    await db.appSetting.createMany({ data: [
      { key: 'integration.zoom.lastTestOk', value: '0' },
      { key: 'integration.zoom.lastTestedAt', value: new Date().toISOString() },
      { key: 'integration.zoom.lastTestDetail', value: 'Zoom no longer accepts the saved connection (Invalid Token!).' },
    ] });
    await db.$disconnect();

    check = new Client({ connectionString: target.toString() });
    await check.connect();
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
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
    const main = page.locator('main');

    // ---------------------------------------------------------------- Overview
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/overview`);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.waitForTimeout(1500);

    // The webinar's name is in the workspace header once, not again as the page title; "setup locked" is said once.
    await expect(page.getByText('Workspace Screens Webinar', { exact: true })).toHaveCount(1);
    await expect(main.getByText('Launched, Setup Locked', { exact: true })).toHaveCount(1);
    await expect(main.getByText('Launched, setup locked', { exact: true })).toHaveCount(0);
    checks.push('O1. The Overview does not repeat the webinar name or the "setup locked" notice');

    // The "date has passed" notice is one compact row, not a block that takes a fifth of every tab.
    const banner = page.locator('.lsq-res-overdue');
    await expect(banner).toBeVisible();
    expect((await banner.boundingBox())!.height).toBeLessThan(90);
    await expect(banner.getByRole('link', { name: 'Go to Results' })).toBeVisible();
    checks.push('O2. The "Webinar Date Has Passed" notice is a single compact row with its action beside it');

    // Nothing to say about background work, so nothing is shown.
    await expect(page.getByText('Background work')).toHaveCount(0);
    checks.push('O3. "Background work" is not shown when there is nothing to report');

    // Registrations by channel.
    const card = page.locator('section[aria-labelledby="ov-registrations"]');
    await expect(card).not.toContainText(/of 7 channels/);
    await expect(card).not.toContainText('Channel tracking link');
    for (const label of ['Email Campaign', 'SMS', 'WhatsApp', 'LinkedIn', 'SDR/Sales', 'Third-parties', 'LinkedIn Event Page', 'Website']) {
      await expect(card.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(card.getByText('Added to each message')).toHaveCount(4);
    await expect(card.getByRole('button', { name: /^Copy tracking link for / })).toHaveCount(4);
    await expect(card.getByRole('button', { name: 'Copy tracking link for Website' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Copy tracking link for Email Campaign' })).toHaveCount(0);
    await expect(card.getByText('3 invites sent')).toBeVisible();
    await expect(card.getByText('No invites sent yet')).toHaveCount(3);
    await expect(card).toContainText('every email, SMS, WhatsApp and LinkedIn message');
    checks.push('O4. All eight channels are listed (SMS too, for a webinar saved without it); only the four shared channels have a link to copy; no made-up channel count');

    // Delivery, About, KPIs.
    await expect(main.getByText(/3 will not send, cadence stopped/)).toBeVisible();
    await expect(page.locator('section[aria-labelledby="ov-about"]').getByText('Vertical', { exact: true })).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby="ov-about"]')).toContainText('Date');
    checks.push('O5. A queued message on a stopped cadence says it will not send; an unset vertical is not shown');

    // Segment bars show each segment's share, so six equal segments are not six full bars.
    const widths = await page.locator('section[aria-labelledby="ov-segments"] .lsq-progress__bar').evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.width)));
    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const w of widths) expect(w).toBeLessThan(60);
    await expect(page.locator('section[aria-labelledby="ov-segments"]')).toContainText('1 · 17%');
    checks.push('O6. Segment bars show each segment\'s share of the audience instead of all filling the row');
    await page.screenshot({ path: `${OUT}/overview.png` });

    // ---------------------------------------------------------------- Messaging: the step that has sent
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/messaging`);
    await expect(page.getByRole('heading', { name: 'Message Copy' })).toBeVisible();
    await page.waitForTimeout(1000);
    const steps = page.getByRole('navigation', { name: 'Cadence steps' });
    const sentStep = steps.getByRole('button', { name: /Initial invite/ });
    await expect(sentStep).toBeVisible();

    // What went out is shown once, as it went out, and nothing about it is called wrong.
    await expect(main.getByText('This is the copy that went out to Person.')).toBeVisible();
    await expect(main.getByText('Subject: Invite: a live session')).toBeVisible();
    await expect(main.getByText('Old Link')).toHaveCount(0);
    await expect(main.getByText('Invalid')).toHaveCount(0);
    await expect(main.getByText('Live Preview')).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Personalization Settings' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Edit Contact Fields' })).toHaveCount(0);
    await expect(main.locator('textarea')).toHaveCount(0);
    await expect(main.getByText('Reviewed')).toHaveCount(3);
    checks.push('M1. A step that has sent shows its copy once, as sent, with no "Old Link", "Invalid", preview, settings or disabled editor');

    // The issues list covers what is still to send, not what already went out.
    const issues = page.locator('.lsq-banner--warning', { hasText: 'Need Fixing' }).or(page.locator('.lsq-banner--warning', { hasText: 'Needs Fixing' }));
    await expect(issues).toContainText('Nudge');
    await expect(issues).not.toContainText('Initial invite');
    checks.push('M2. The "issues" list names only the steps still waiting, never the one that sent');

    // The search sits with the recipients, below the step heading, not above the page title.
    const searchBox = page.getByRole('searchbox');
    const stepHeading = page.getByRole('heading', { name: 'Copy for This Step' });
    expect((await searchBox.boundingBox())!.y).toBeGreaterThan((await stepHeading.boundingBox())!.y);
    await expect(searchBox).toHaveClass(/lsq-input/);
    checks.push('M3. Recipient search is a styled row placed just above the recipients');

    // ---------------------------------------------------------------- Messaging: a step still to send keeps its checks
    await steps.getByRole('button', { name: /Nudge/ }).click();
    await expect(page).toHaveURL(/step=nudge/);
    await expect(page.getByRole('heading', { name: 'Personalization Settings' })).toBeVisible();
    await expect(main.getByText('Invalid').first()).toBeVisible();
    await expect(main.getByText('This is the copy that went out')).toHaveCount(0);
    checks.push('M4. A step that has not sent still shows its settings and flags a copy that fails validation');
    await page.screenshot({ path: `${OUT}/messaging-pending.png` });

    // ---------------------------------------------------------------- Audience
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/audience`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audience' })).toBeVisible();
    await expect(main.getByText('Launched, setup locked', { exact: true })).toHaveCount(0);
    await expect(main.getByText(/launched, so the audience and approvals are locked/)).toBeVisible();
    // The approval rule can be read in full, not cut off after a few words.
    await expect(main.getByText(/verified email on file/)).toBeVisible();
    checks.push('A1. The Audience page does not repeat its title or the "locked" notice, and shows the whole approval rule');

    const rows = main.locator('table tbody tr');
    await expect(rows).toHaveCount(6);
    await main.getByRole('button', { name: /^Good 70–84/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(main.getByRole('button', { name: /^All 6/ })).toBeVisible(); // the chip counts everyone, not just what the filter left
    await main.getByRole('button', { name: /^All 6/ }).click();
    await expect(rows).toHaveCount(6);
    await page.getByRole('searchbox', { name: 'Search contacts' }).or(page.getByLabel('Search contacts')).first().fill('Person 4');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Person 4');
    checks.push('A2. Score-band filters and the contact search narrow the list, and clearing the filter brings everyone back');

    await page.goto(`${ORIGIN}/campaigns/${campaignId}/audience`);
    await main.getByRole('button', { name: 'Why this score' }).first().click();
    await expect(main.getByRole('button', { name: 'Hide explanation' }).first()).toBeVisible();
    await expect(main.getByText(/^Scored 90: VP in Marketing\./)).toBeVisible();
    await expect(main.getByRole('checkbox', { name: /Approve|Un-approve/ })).toHaveCount(0);
    checks.push('A3. "Why this score" opens an explanation, and nothing on a launched webinar can be re-approved');

    const [csv] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: /^Export All 6/ }).click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const csvText = await (await import('node:fs/promises')).readFile((await csv.path())!, 'utf8');
    expect(csvText.trim().split('\n')).toHaveLength(7);
    expect(csvText).toContain('Person 1');
    checks.push('A4. Export downloads a CSV with every contact');

    // ---------------------------------------------------------------- Registration
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/registration`);
    await expect(page.getByRole('heading', { name: 'How People Register' })).toBeVisible();
    await expect(main.getByText('Launch Readiness')).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Registration Health' })).toBeVisible();
    await expect(main.getByText('Not Ready')).toHaveCount(0);
    await expect(main.getByText('The webinar has taken place.')).toBeVisible();
    await expect(main.getByText('Registration closed when the webinar ended.')).toBeVisible();
    await expect(main.getByText('Turn On Registration')).toHaveCount(0);
    await expect(main.getByText('the Zoom event is no longer taking registrations')).toBeVisible();
    checks.push('R1. A webinar that has taken place shows registration health, not a launch to-do list: nothing "needs fixing" about its date, closed registration or Zoom switch');

    await expect(main.getByRole('button', { name: 'Save Registration Settings' })).toBeDisabled();
    await expect(main.getByRole('radio').first()).toBeDisabled();
    const shared = main.getByRole('button', { name: /^Copy/ });
    await expect(shared).toHaveCount(4);
    await shared.first().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(new RegExp(`/register/${campaignId}\\?c=sdr_sales$`));
    checks.push('R2. Registration settings are locked after launch; each shared channel link copies to the clipboard');

    // ---------------------------------------------------------------- Cadence
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/cadence`);
    await expect(page.getByRole('heading', { level: 1, name: 'Outreach Cadence' })).toBeVisible();
    await expect(main.getByText('Scheduled', { exact: true })).toHaveCount(0);
    await expect(main.getByText('Will not send').first()).toBeVisible();
    await expect(main.getByText('will not send, cadence stopped')).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    checks.push('C1. On a stopped cadence, unsent steps say "Will not send" instead of "Scheduled", and the queue says it will not send');

    // The LinkedIn queue belongs to the LinkedIn touch step, not to every step that happens to use LinkedIn.
    await expect(main.getByText(/to send\s+on LinkedIn/)).toHaveCount(1);
    checks.push('C2. The LinkedIn send queue appears once, on the LinkedIn touch, not again on a registrants-only reminder');

    // ---------------------------------------------------------------- Results
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/results`);
    await expect(page.getByRole('heading', { name: 'Campaign Results' })).toBeVisible();
    await expect(page.locator('.lsq-res-overdue').getByRole('link', { name: 'Go to Results' })).toHaveCount(0);
    await expect(page.locator('.lsq-res-overdue')).toBeVisible();
    await expect(main.getByText('Cadence stopped')).toHaveCount(1); // the Cadence Control badge; not repeated in the page header
    checks.push('X1. The Results page does not offer a "Go to Results" shortcut to itself, and says "Cadence stopped" once');

    const log = page.locator('section[aria-labelledby="res-activity"]');
    await expect(log).not.toContainText('real-time to LeadSquared');
    await expect(log).not.toContainText('Running');
    await expect(log.locator('li', { hasText: 'Webinar created' }).getByText(/Running|Done|Attention/)).toHaveCount(0);
    await expect(log.locator('li', { hasText: 'Launched cadence' })).toContainText('Done');
    await expect(log.locator('li', { hasText: '1 contact has no usable email' })).toContainText('Attention');
    checks.push('X2. The activity log gives an informational entry no status, and does not claim to be real-time');

    const zoomCard = page.locator('section[aria-labelledby="res-zoom"]');
    await expect(zoomCard).toContainText('Zoom needs reconnecting');
    await expect(zoomCard).not.toContainText('pulls in automatically');
    await expect(zoomCard.getByRole('link', { name: 'Reconnect Zoom' })).toHaveAttribute('href', '/integrations');
    checks.push('X3. The Zoom attendance card warns when Zoom no longer accepts the connection, instead of saying "Linked" and "pulls in automatically"');

    await expect(main.getByText('Sent by email through Netcore').first()).toBeVisible();
    await expect(main.getByText('Sent via LeadSquared')).toHaveCount(0);
    const control = page.locator('section[aria-labelledby="res-control"]');
    // A stopped cadence has nothing to pause, stop, retry or run, so those buttons are not shown at all.
    for (const name of ['Resume', 'Pause', 'Stop', 'Retry Failed Sends', 'Run Due Sends Now']) await expect(control.getByRole('button', { name })).toHaveCount(0);
    await expect(control.getByRole('button', { name: 'Restart Cadence' })).toBeVisible();
    await expect(control).not.toContainText('Start a new cadence from the Cadence tab');
    await control.getByRole('button', { name: 'Edit Step Timing' }).click();
    await expect(page).toHaveURL(/\/cadence/);
    checks.push('X4. A stopped cadence shows only what can act on it (restart, reschedule, step timing), with a truthful note; follow-up cards say email goes through Netcore');

    // ---------------------------------------------------------------- Cadence: changing a step
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/cadence`);
    // The step's own title (other rows mention "nudge" in their descriptions).
    const stepRow = (title: string) => page.locator('li.lsq-step-row').filter({ has: page.locator('.lsq-step-row__title', { hasText: new RegExp(`^${title}`) }) });
    const nudgeRow = stepRow('Nudge').first();
    const save = page.getByRole('button', { name: 'Save Changes' });
    await expect(save).toBeDisabled();
    await nudgeRow.getByRole('switch', { name: 'Send Nudge' }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(async () => (await check!.query(`SELECT enabled FROM "CadenceStep" WHERE "campaignId"=$1 AND key='nudge'`, [campaignId])).rows[0]?.enabled, { timeout: 15_000 }).toBe(false);
    await page.reload();
    // A step that is off leaves the Active view and is still there, marked Off, under All steps.
    await expect(stepRow('Nudge')).toHaveCount(0);
    await page.getByRole('button', { name: /^All steps/ }).click();
    await expect(stepRow('Nudge').first().getByText('Off', { exact: true })).toBeVisible();
    checks.push('C3. Turning a step off and saving persists: it leaves the Active view and reads "Off" under All steps');

    // ---------------------------------------------------------------- Results: the buttons
    const resultsUrl = `${ORIGIN}/campaigns/${campaignId}/results`;
    const toast = (text: string | RegExp) => page.locator('[role=status]', { hasText: text }).last();
    const attention = page.locator('section[aria-labelledby="res-attention"]');
    await page.goto(resultsUrl);

    // Retry on a failed CRM sync re-runs that sync (not message sends), and clears the card only when it worked.
    await expect(attention.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await attention.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(toast(/Synced to LeadSquared: \d+ created/)).toBeVisible({ timeout: 20_000 });
    await expect(attention.getByText('LeadSquared lead sync failed')).toHaveCount(0);
    expect(Number((await check!.query(`SELECT count(*)::int AS n FROM "Contact" WHERE "campaignId"=$1 AND "lsqLeadId" IS NOT NULL`, [campaignId])).rows[0].n)).toBeGreaterThan(0);
    checks.push('X5. Retry on a failed LeadSquared sync runs that sync on a stopped cadence, writes the leads, and clears the card');

    // A sync that fails again keeps the card and says why, in words.
    await check!.query(`UPDATE "Contact" SET "lsqLeadId"=NULL WHERE "campaignId"=$1`, [campaignId]);
    await check!.query(`INSERT INTO "AttentionItem" (id, "campaignId", icon, color, title, detail, "actionsCsv") VALUES ($1, $2, 'ErrorProperty1Outline', 'error', 'LeadSquared lead sync failed', 'Old reason', 'retry')`, [`att${randomBytes(6).toString('hex')}`, campaignId]);
    await lsq.stop();
    await page.goto(resultsUrl);
    await attention.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('[role=status]', { hasText: 'The LeadSquared sync failed again:' }).last()).toBeVisible({ timeout: 20_000 });
    await expect(attention.getByText('LeadSquared lead sync failed')).toBeVisible();
    await expect(attention).not.toContainText('Old reason');
    checks.push('X6. A retry that fails again keeps the card, replaces the old reason with the new one, and says so');

    // Retry on something that is fixed elsewhere sends you there instead of pretending.
    await check!.query(`INSERT INTO "AttentionItem" (id, "campaignId", icon, color, title, detail, "actionsCsv") VALUES ($1, $2, 'ErrorProperty1Outline', 'error', 'Audience scoring failed', 'Claude was not reachable.', 'retry')`, [`att${randomBytes(6).toString('hex')}`, campaignId]);
    await page.goto(resultsUrl);
    await attention.getByRole('button', { name: 'Retry In Audience' }).click();
    await expect(page).toHaveURL(/\/audience/);
    await page.goto(resultsUrl);
    await expect(attention.getByText('Audience scoring failed')).toBeVisible(); // not dismissed
    checks.push('X7. Retry on a scoring failure opens the Audience tab and leaves the card in place');

    // The other buttons say what happened, in words, in this build: no masked or raw errors.
    await main.getByRole('button', { name: 'Sync Zoom Now' }).click();
    await expect(toast(/Zoom's participants report could not be fetched: Zoom is not connected\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('ZoomError:')).toHaveCount(0);
    await main.getByRole('button', { name: 'Generate AI Debrief' }).click();
    await expect(toast(/Claude is not configured, so this debrief is a template summary/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('AI executive debrief generated.')).toHaveCount(0);
    await main.getByRole('button', { name: /Push to LSQ/ }).click();
    await expect(page.locator('[role=status]', { hasText: /LeadSquared|fetch failed|could not|ECONNREFUSED/i }).last()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Minified React error/)).toHaveCount(0);
    checks.push('X8. Sync Zoom Now, Generate AI Debrief and Push to LSQ each answer in plain words; none shows a React error code or a raw error name');

    // Attendance.
    await main.getByRole('button', { name: 'Import Attendance CSV' }).click();
    const modal = page.getByRole('dialog', { name: 'Import Attendee List' });
    await expect(modal).toBeVisible();
    await modal.getByRole('textbox').first().fill('p1@example.com, 45\np2@example.com 30\nstranger@example.com');
    await expect(modal.getByRole('button', { name: 'Import 3 Attendees' })).toBeEnabled();
    await modal.getByRole('button', { name: 'Import 3 Attendees' }).click();
    await expect(toast(/Imported attendance: \d+ attended, \d+ no-show\./)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => Number((await check!.query(`SELECT count(*)::int AS n FROM "Contact" WHERE "campaignId"=$1 AND attended=true`, [campaignId])).rows[0].n), { timeout: 15_000 }).toBe(2);
    checks.push('X9. Importing an attendee list marks the registered people who attended (and ignores an address that never registered)');

    // ---------------------------------------------------------------- Starting a stopped cadence over
    await page.goto(resultsUrl);
    const ctl = page.locator('section[aria-labelledby="res-control"]');
    const noteBox = ctl.locator('.lsq-banner[role=status]');
    await expect(ctl.getByRole('button', { name: 'Restart Cadence' })).toBeDisabled();
    await expect(ctl).toContainText('The webinar date has passed');
    await expect(ctl.getByRole('button', { name: 'Launch Cadence' })).toHaveCount(0);
    checks.push('L1. A stopped cadence on a webinar whose date has passed offers Restart Cadence, disabled, and says to move the webinar first');

    // Move the webinar: a date that is not ahead is refused; a real one is accepted.
    await ctl.getByRole('button', { name: 'Reschedule Webinar' }).click();
    const resched = page.getByRole('dialog', { name: 'Reschedule Webinar' });
    await expect(resched).toBeVisible();
    await resched.getByLabel('New date').fill('2020-01-01');
    await resched.getByRole('button', { name: 'Move Webinar' }).click();
    await expect(resched.getByText(/still ahead/)).toBeVisible();
    const ahead = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    await resched.getByLabel('New date').fill(ahead);
    await resched.getByRole('button', { name: 'Move Webinar' }).click();
    await expect(noteBox).toContainText('Webinar moved to', { timeout: 20_000 });
    await expect(noteBox).toContainText('change its date in Zoom too');
    await expect(page.locator('.lsq-res-overdue')).toHaveCount(0);
    await expect(ctl.getByRole('button', { name: 'Restart Cadence' })).toBeEnabled();
    checks.push('L2. Reschedule Webinar refuses a date that is not ahead, moves the webinar when it is, reminds you the Zoom event is separate, and the "date has passed" notice goes');

    // Restart: a fresh run, with what was sent left alone.
    await ctl.getByRole('button', { name: 'Restart Cadence' }).click();
    await expect(page.getByText('Restart This Cadence?')).toBeVisible();
    await page.getByRole('button', { name: 'Restart Cadence' }).last().click();
    await expect(noteBox).toContainText('Cadence reset.', { timeout: 20_000 });
    await expect(ctl.getByRole('button', { name: 'Launch Cadence' })).toBeVisible();
    await expect.poll(async () => (await check!.query(`SELECT "cadenceStatus" FROM "Campaign" WHERE id=$1`, [campaignId])).rows[0]?.cadenceStatus, { timeout: 15_000 }).toBe('not_started');
    expect(Number((await check!.query(`SELECT count(*)::int AS n FROM "CadenceSend" WHERE "campaignId"=$1 AND status='sent'`, [campaignId])).rows[0].n)).toBe(3);
    checks.push('L3. Restart Cadence resets a stopped cadence (confirmed first) and offers Launch Cadence; the three messages already sent are still sent');

    // Launch: a webinar that is not ready says why, as a list; one that is ready launches.
    await check!.query(`UPDATE "Campaign" SET "zoomMeetingId"='99460613345' WHERE id=$1`, [campaignId]); // Zoom still linked but not connected: a real blocker
    await ctl.getByRole('button', { name: 'Launch Cadence' }).click();
    await expect(noteBox).toContainText('This webinar is not ready to launch yet.', { timeout: 20_000 });
    const problems = ctl.locator('.lsq-banner li');
    expect(await problems.count()).toBeGreaterThan(0);
    await expect(page.getByText(/Minified React error/)).toHaveCount(0);
    expect((await check!.query(`SELECT "cadenceStatus" FROM "Campaign" WHERE id=$1`, [campaignId])).rows[0].cadenceStatus).toBe('not_started');
    checks.push('L4. Launch Cadence on a webinar that is not ready lists each reason in plain words and changes nothing');

    await check!.query(`UPDATE "Campaign" SET "zoomMeetingId"=NULL WHERE id=$1`, [campaignId]);
    await ctl.getByRole('button', { name: 'Launch Cadence' }).click();
    await expect(noteBox).toContainText('Cadence launched.', { timeout: 30_000 });
    await expect.poll(async () => (await check!.query(`SELECT "cadenceStatus" FROM "Campaign" WHERE id=$1`, [campaignId])).rows[0]?.cadenceStatus, { timeout: 15_000 }).toBe('running');
    await expect(ctl.getByRole('button', { name: 'Pause' })).toBeEnabled();
    await expect(ctl.getByRole('button', { name: 'Restart Cadence' })).toHaveCount(0);
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/cadence`);
    await expect(main.getByText('This cadence is stopped')).toHaveCount(0);
    await expect(main.getByText('Add a step').first()).toBeVisible();
    checks.push('L5. Once ready, Launch Cadence starts the run; the controls become Pause/Stop and the Cadence tab takes new steps again');

    // Completing the webinar locks the workspace and removes the "date has passed" notice.
    await page.goto(resultsUrl);
    await main.getByRole('button', { name: 'Mark Webinar as Completed' }).click();
    await expect(page.getByText('Mark Webinar as Completed?')).toBeVisible();
    await page.getByRole('button', { name: 'Mark as Completed', exact: true }).click();
    await expect(toast(/Webinar marked completed/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await check!.query(`SELECT status FROM "Campaign" WHERE id=$1`, [campaignId])).rows[0]?.status, { timeout: 15_000 }).toBe('completed');
    await page.goto(`${ORIGIN}/campaigns/${campaignId}/overview`);
    await expect(page.locator('.lsq-res-overdue')).toHaveCount(0);
    await expect(main.getByText('Completed', { exact: true }).first()).toBeVisible();
    checks.push('X10. Marking the webinar completed records it, removes the "date has passed" notice and shows it as completed');

    // ---------------------------------------------------------------- Phone width
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ['overview', 'messaging']) {
      await page.goto(`${ORIGIN}/campaigns/${campaignId}/${path}`);
      await page.waitForTimeout(1200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} fits a phone`).toBe(true);
    }
    checks.push('P1. Both tabs fit a phone-width screen without sideways scrolling');

    expect(errors, 'Browser runtime errors').toEqual([]);
    await writeFile(`${OUT}/results.json`, JSON.stringify({ checks }, null, 2));
    console.log(`Workspace screen checks passed: ${checks.length}.\n` + checks.map((c) => `  - ${c}`).join('\n'));
  } catch (error) { await captureBrowserFailure(browser, OUT, error); throw error; } finally {
    await writeFile(`${OUT}/server.log`, logs.join('')).catch(() => undefined);
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((r) => server!.once('exit', () => r()));
    }
    await lsq.stop().catch(() => undefined);
    await check?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
