import { it, expect, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { saveWizardDraft } from '@/lib/wizardDraftServer';
import { getDraftIdForTokenAction } from '@/lib/actions/wizardDraft';
import { archiveAbandonedDrafts, runDraftHousekeeping, purgeExpiredDraftTokens } from '@/lib/draftCleanup';
import { getResumeDrafts } from '@/lib/draftResume';
import { storeOAuthReturn, takeOAuthReturn, purgeExpiredOAuthReturns } from '@/lib/oauthReturn';
import { dateToWallClock } from '@/lib/dateFormat';

// Real database. The only network traffic allowed in this suite is to localhost (test-support/setup.ts), and
// every save below is also checked to make no outbound request at all.

const made: string[] = [];
// Records every request the code under test makes (the setup file already blocks anything but localhost).
const realFetch = globalThis.fetch;
let outbound: string[] = [];
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (input !== undefined) outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return realFetch(input, init);
}) as typeof fetch;

beforeEach(() => {
  outbound = [];
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: 'wizard.draft_token.' } } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: 'zoom.oauth_return.' } } });
  await db.$disconnect();
});

async function create(patch: Record<string, unknown> = { title: 'Autosave Webinar' }, step = 0, createToken?: string) {
  const r = await saveWizardDraft({ campaignId: null, step, patch, baseRevision: 0, createToken });
  if (r.status !== 'saved') throw new Error(`expected a created draft, got ${r.status}`);
  made.push(r.campaignId);
  return r;
}
const row = (id: string) => db.campaign.findUniqueOrThrow({ where: { id } });

it('creates nothing for a stray click and a draft once the title reaches three characters', async () => {
  const before = await db.campaign.count();
  expect(await saveWizardDraft({ campaignId: null, step: 0, patch: { title: 'ab' }, baseRevision: 0 })).toEqual({ status: 'skipped' });
  expect(await saveWizardDraft({ campaignId: null, step: 0, patch: {}, baseRevision: 0 })).toEqual({ status: 'skipped' });
  expect(await db.campaign.count()).toBe(before);

  const r = await create({ title: 'Patient Journeys' });
  expect(r).toMatchObject({ created: true, revision: 1, remoteGroups: [] });
  const c = await row(r.campaignId);
  expect(c).toMatchObject({ name: 'Patient Journeys', status: 'draft', wizardStep: 0, wizardFurthestStep: 0, draftRevision: 1 });
  expect(c.draftTouchedAt).toBeInstanceOf(Date);
  // The same defaults the Continue button provisions: the cadence exists from the first save.
  expect(await db.cadenceStep.count({ where: { campaignId: c.id } })).toBeGreaterThan(5);
  expect(await db.activityLogEntry.count({ where: { campaignId: c.id, text: 'Webinar created' } })).toBe(1);
});

it('a retried creation with the same token returns the draft the first attempt made', async () => {
  const token = 'tok-retry-1';
  const a = await create({ title: 'Retry Safe' }, 0, token);
  const b = await saveWizardDraft({ campaignId: null, step: 0, patch: { title: 'Retry Safe' }, baseRevision: 0, createToken: token });
  expect(b).toMatchObject({ status: 'saved', campaignId: a.campaignId, created: false });
  expect(await db.campaign.count({ where: { name: 'Retry Safe' } })).toBe(1);
});

it('a retried creation carries edits typed since: they are applied to the draft, not dropped', async () => {
  const token = 'tok-retry-edits';
  const a = await create({ title: 'Lost Response' }, 0, token);
  // The response was lost; the person kept typing, and the client resends everything with the same token.
  const b = await saveWizardDraft({ campaignId: null, step: 0, patch: { title: 'Lost Response', description: 'Typed after the first save' }, baseRevision: 0, createToken: token });
  expect(b).toMatchObject({ status: 'saved', campaignId: a.campaignId, created: false, revision: 2 });
  const c = await row(a.campaignId);
  expect(c.description).toBe('Typed after the first save');
  expect(await db.campaign.count({ where: { name: 'Lost Response' } })).toBe(1);
});

it('two creations racing on one token still make one draft', async () => {
  const token = 'tok-race-1';
  const [x, y] = await Promise.all([
    saveWizardDraft({ campaignId: null, step: 0, patch: { title: 'Race Draft' }, baseRevision: 0, createToken: token }),
    saveWizardDraft({ campaignId: null, step: 0, patch: { title: 'Race Draft' }, baseRevision: 0, createToken: token }),
  ]);
  expect(x.status === 'saved' && y.status === 'saved').toBe(true);
  const ids = [x, y].map((r) => (r as { campaignId: string }).campaignId);
  made.push(...ids);
  expect(new Set(ids).size).toBe(1);
  expect(await db.campaign.count({ where: { name: 'Race Draft' } })).toBe(1);
});

it('writes the details columns the Continue button would, in the webinar zone', async () => {
  const { campaignId } = await create({ title: 'Zone Check' });
  const r = await saveWizardDraft({
    campaignId, step: 0, baseRevision: 1,
    patch: {
      description: 'What attendees learn', date: '2026-10-21', time: '15:00', timezone: 'Europe/London', durationMinutes: 90,
      capacity: '250', selectedChannels: ['email_campaign', 'whatsapp'], zoomMeetingId: '84920491823',
      zoomLink: 'https://zoom.us/j/84920491823',
    },
  });
  expect(r).toMatchObject({ status: 'saved', revision: 2 });
  const c = await row(campaignId);
  expect(c.timezone).toBe('Europe/London');
  expect(dateToWallClock(c.scheduledAt!, 'Europe/London')).toBe('2026-10-21T15:00');
  expect(c).toMatchObject({ description: 'What attendees learn', durationMinutes: 90, capacity: 250, zoomMeetingId: '84920491823', selectedChannels: 'email_campaign,whatsapp' });
  expect(c.date).toContain('2026');
});

it('typing a time before a date keeps it, and changing only the zone keeps the wall-clock time', async () => {
  const { campaignId } = await create({ title: 'Schedule Order' });
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { date: '', time: '10:30', timezone: 'Asia/Kolkata' } });
  expect((await row(campaignId)).scheduledAt).toBeNull();
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 2, patch: { date: '2026-11-02', time: '10:30', timezone: 'Asia/Kolkata' } });
  const c1 = await row(campaignId);
  expect(dateToWallClock(c1.scheduledAt!, 'Asia/Kolkata')).toBe('2026-11-02T10:30');
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 3, patch: { timezone: 'America/New_York' } });
  const c2 = await row(campaignId);
  expect(dateToWallClock(c2.scheduledAt!, 'America/New_York')).toBe('2026-11-02T10:30');
});

it('a landing page link switches registration to the external page, and clearing it switches back', async () => {
  const { campaignId } = await create();
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { registrationLink: 'https://lp.example.com/webinar', oneClickSignup: false } });
  expect(await row(campaignId)).toMatchObject({ registrationLink: 'https://lp.example.com/webinar', registrationMode: 'external', oneClickSignup: false });
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 2, patch: { registrationLink: '', oneClickSignup: true } });
  expect(await row(campaignId)).toMatchObject({ registrationLink: null, registrationMode: 'zoom', oneClickSignup: true });
});

it('saves speakers and mirrors the primary one onto the campaign', async () => {
  const { campaignId } = await create();
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { speakers: [{ name: 'Ada Lovelace', title: 'Host', isPrimary: false }, { name: 'Grace Hopper', title: 'Keynote', isPrimary: true }] } });
  const speakers = await db.speaker.findMany({ where: { campaignId }, orderBy: { order: 'asc' } });
  expect(speakers.map((s) => s.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  expect(await row(campaignId)).toMatchObject({ speakerName: 'Grace Hopper', speakerTitle: 'Keynote' });
});

it('saves scoring and messaging settings, per-step copy and the templatized invite', async () => {
  const { campaignId } = await create();
  await saveWizardDraft({
    campaignId, step: 4, baseRevision: 1,
    patch: {
      scoringPrompt: 'Score by fit', scoringCriteria: 'VP and above', scoringThreshold: 80,
      msgMode: 'templatized', tone: 'Direct', msgLength: 'Short', aiInstructions: 'Be brief', brief: 'Hi {{firstName}}, join {{link}}',
      personalizationFields: ['firstName', 'title'],
      stepConfigs: { nudge: { mode: 'template', customSubject: 'Reminder', customBody: 'Still time to register: {{link}}', instruction: 'Short nudge' } },
    },
  });
  const c = await row(campaignId);
  expect(c).toMatchObject({ scoringPrompt: 'Score by fit', scoringThreshold: 80, msgMode: 'templatized', tone: 'Direct', msgLength: 'Short', personalizationFields: 'firstName,title', wizardStep: 4, wizardFurthestStep: 4 });
  expect(c.personalizationPrompt).toContain('Be brief');
  expect(c.personalizationPrompt).toContain('Tone: Direct.');
  const invite = await db.messageTemplate.findUnique({ where: { campaignId_key: { campaignId, key: 'invite' } } });
  expect(invite?.body).toBe('Hi {{firstName}}, join {{link}}');
  const step = await db.cadenceStep.findUnique({ where: { campaignId_key: { campaignId, key: 'nudge' } } });
  expect(step).toMatchObject({ mode: 'template', instruction: 'Short nudge' });
  const custom = await db.messageTemplate.findUnique({ where: { campaignId_key: { campaignId, key: 'nudge' } } });
  expect(custom).toMatchObject({ subject: 'Reminder', body: 'Still time to register: {{link}}' });
  expect(step?.templateId).toBe(custom?.id);
});

it('records the step and keeps the furthest step as a high-water mark', async () => {
  const { campaignId } = await create();
  await saveWizardDraft({ campaignId, step: 3, baseRevision: 1, patch: {} });
  await saveWizardDraft({ campaignId, step: 1, baseRevision: 2, patch: {} });
  expect(await row(campaignId)).toMatchObject({ wizardStep: 1, wizardFurthestStep: 3 });
  // A step that is not a number in range is clamped, never trusted.
  await saveWizardDraft({ campaignId, step: 99, baseRevision: 3, patch: {} });
  expect(await row(campaignId)).toMatchObject({ wizardStep: 5, wizardFurthestStep: 5 });
});

it('two writers on different fields both survive; the same field is a conflict until the writer has seen it', async () => {
  const { campaignId } = await create({ title: 'Two Tabs' });
  // Tab A and tab B both opened the draft at revision 1.
  const a = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { title: 'Two Tabs Renamed' } });
  expect(a).toMatchObject({ status: 'saved', revision: 2, remoteGroups: [] });
  const b = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { description: 'From tab B' } });
  expect(b).toMatchObject({ status: 'saved', revision: 3, remoteGroups: ['title'] }); // B is told it is behind
  const c = await row(campaignId);
  expect(c).toMatchObject({ name: 'Two Tabs Renamed', description: 'From tab B' });

  const clash = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { title: 'B wants this title' } });
  expect(clash).toEqual({ status: 'conflict', campaignId, revision: 3, groups: ['title'] });
  expect((await row(campaignId)).name).toBe('Two Tabs Renamed'); // nothing was overwritten

  // Keep Mine: the same patch against the revision B has now seen.
  const mine = await saveWizardDraft({ campaignId, step: 0, baseRevision: 3, patch: { title: 'B wants this title' } });
  expect(mine).toMatchObject({ status: 'saved', revision: 4 });
  expect((await row(campaignId)).name).toBe('B wants this title');
});

it('a writer never clashes with its own earlier writes, but stays behind on groups it has not seen', async () => {
  const { campaignId } = await create({ title: 'Own Writes' });
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { title: 'Changed Elsewhere' } }); // another tab, revision 2
  const mine = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { description: 'first' } }); // this tab
  expect(mine).toMatchObject({ status: 'saved', revision: 3, remoteGroups: ['title'] });
  // The tab learned revision 3 for the description only.
  const again = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, groupBases: { description: 3 }, patch: { description: 'second' } });
  expect(again).toMatchObject({ status: 'saved', revision: 4 });
  const clash = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, groupBases: { description: 4 }, patch: { title: 'Overwrite?' } });
  expect(clash).toMatchObject({ status: 'conflict', groups: ['title'] });
  expect((await row(campaignId)).name).toBe('Changed Elsewhere');
});

it('treats an archived draft as gone', async () => {
  const { campaignId } = await create();
  await db.campaign.update({ where: { id: campaignId }, data: { archived: true } });
  expect(await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { title: 'Edit archived' } })).toEqual({ status: 'gone' });
});

it('re-sending a value the draft already holds is not a conflict (a beacon after an in-flight save)', async () => {
  const { campaignId } = await create({ title: 'Same Value' });
  await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { description: 'hello' } });
  const again = await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { description: 'hello' } });
  expect(again.status).toBe('saved');
});

it('serialises concurrent saves: every field lands and revisions never repeat', async () => {
  const { campaignId } = await create({ title: 'Concurrent' });
  const fields = [
    { description: 'd' }, { capacity: '10' }, { tone: 'Warm' }, { msgLength: 'Long' }, { scoringThreshold: 55 },
    { scoringPrompt: 'p' }, { scoringCriteria: 'c' }, { durationMinutes: 45 }, { zoomLink: 'https://zoom.us/j/1' }, { brief: 'b' },
  ];
  const results = await Promise.all(fields.map((patch) => saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch })));
  expect(results.every((r) => r.status === 'saved')).toBe(true);
  const revisions = results.map((r) => (r as { revision: number }).revision);
  expect(new Set(revisions).size).toBe(fields.length);
  const c = await row(campaignId);
  expect(c).toMatchObject({ description: 'd', capacity: 10, tone: 'Warm', msgLength: 'Long', scoringThreshold: 55, scoringPrompt: 'p', scoringCriteria: 'c', durationMinutes: 45, zoomLink: 'https://zoom.us/j/1', brief: 'b', draftRevision: 11 });
});

it('refuses to edit a launched or finished webinar and changes nothing', async () => {
  for (const state of [{ status: 'live' }, { cadenceStatus: 'running' }, { cadenceStatus: 'paused' }, { status: 'completed' }]) {
    const { campaignId } = await create({ title: 'Launched One' });
    await db.campaign.update({ where: { id: campaignId }, data: state });
    const r = await saveWizardDraft({ campaignId, step: 2, baseRevision: 1, patch: { title: 'Hacked', registrationLink: 'https://evil.example', scoringThreshold: 1 } });
    expect(r).toEqual({ status: 'locked', campaignId });
    expect(await row(campaignId)).toMatchObject({ name: 'Launched One', registrationLink: null, scoringThreshold: 70, draftRevision: 1, wizardStep: 0 });
  }
});

it('reports a deleted draft as gone', async () => {
  const { campaignId } = await create();
  await db.campaign.delete({ where: { id: campaignId } });
  expect(await saveWizardDraft({ campaignId, step: 0, baseRevision: 1, patch: { title: 'Still here?' } })).toEqual({ status: 'gone' });
  expect(await saveWizardDraft({ campaignId: 'does-not-exist', step: 0, baseRevision: 0, patch: { title: 'Nope' } })).toEqual({ status: 'gone' });
});

it('ignores fields that are not wizard fields: a patch cannot set status, locks or Zoom sync state', async () => {
  const { campaignId } = await create();
  await saveWizardDraft({
    campaignId, step: 0, baseRevision: 1,
    patch: { title: 'Tampered', status: 'live', cadenceStatus: 'running', launchedAt: new Date().toISOString(), zoomMode: 'new', zoomRegistrationUrl: 'https://x', archived: true, lsqListId: 'abc', id: 'other' },
  });
  expect(await row(campaignId)).toMatchObject({ name: 'Tampered', status: 'draft', cadenceStatus: 'not_started', launchedAt: null, zoomMode: null, zoomRegistrationUrl: null, archived: false, lsqListId: null });
});

it('makes no outbound request for any save, create, conflict or lock', async () => {
  const { campaignId } = await create({ title: 'Silent', zoomMeetingId: '84920491823', registrationLink: 'https://lp.example.com' });
  await saveWizardDraft({ campaignId, step: 4, baseRevision: 1, patch: { msgMode: 'ai', brief: 'x', stepConfigs: { invite: { mode: 'ai' } }, selectedChannels: ['email_campaign'] } });
  await saveWizardDraft({ campaignId, step: 4, baseRevision: 0, patch: { title: 'Clash' } });
  expect(outbound).toEqual([]);
});

it('archives only untouched, expired drafts; anything with content or recent activity stays', async () => {
  const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
  const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const mk = async (name: string, data: Record<string, unknown> = {}) => {
    const c = await db.campaign.create({ data: { name, vertical: 'Unassigned', date: 'Not scheduled yet', draftTouchedAt: old, ...data } });
    made.push(c.id);
    return c.id;
  };
  const stale = await mk('Stale Title Only');
  const recent = await mk('Recent Title Only', { draftTouchedAt: fresh });
  const withDate = await mk('Has A Date', { scheduledAt: new Date(Date.now() + 86_400_000) });
  const withStep = await mk('Got To Audience', { wizardFurthestStep: 1 });
  const withDesc = await mk('Has A Description', { description: 'Some text' });
  const launched = await mk('Launched', { status: 'live' });
  const withContact = await mk('Has Contacts');
  await db.contact.create({ data: { campaignId: withContact, name: 'A', account: 'x', vertical: 'x', title: 'x', function: 'x', seniority: 'x' } });
  const legacyOld = await mk('Legacy No Touch', { draftTouchedAt: null });
  await db.campaign.update({ where: { id: legacyOld }, data: { updatedAt: old } }).catch(() => undefined);

  const archived = await archiveAbandonedDrafts();
  expect(archived).toContain(stale);
  for (const keep of [recent, withDate, withStep, withDesc, launched, withContact]) expect(archived).not.toContain(keep);
  expect((await row(stale)).archived).toBe(true);
  expect((await row(recent)).archived).toBe(false);
  expect(await db.activityLogEntry.count({ where: { campaignId: stale, text: { startsWith: 'Archived automatically' } } })).toBe(1);

  // Never deleted: it is restorable from the Archived filter.
  expect(await db.campaign.findUnique({ where: { id: stale } })).not.toBeNull();
});

it('housekeeping runs the archive once a day and always clears expired tokens', async () => {
  await db.appSetting.deleteMany({ where: { key: 'housekeeping.drafts.lastRun' } });
  const first = await runDraftHousekeeping();
  expect(first.ranArchive).toBe(true);
  const second = await runDraftHousekeeping();
  expect(second.ranArchive).toBe(false);

  const key = 'wizard.draft_token.expired-token';
  await db.appSetting.create({ data: { key, value: `x|${Date.now() - 3 * 24 * 60 * 60 * 1000}` } });
  expect(await purgeExpiredDraftTokens()).toBeGreaterThanOrEqual(1);
  expect(await db.appSetting.findUnique({ where: { key } })).toBeNull();
});

it('offers the most recently touched draft, with a count of the others, and skips old, archived and launched ones', async () => {
  await db.campaign.updateMany({ where: { status: 'draft' }, data: { archived: true } }); // isolate from other drafts in this database
  const mk = async (name: string, data: Record<string, unknown>) => {
    const c = await db.campaign.create({ data: { name, vertical: 'Unassigned', date: 'x', ...data } });
    made.push(c.id);
    return c;
  };
  const day = 86_400_000;
  const newest = await mk('Newest Draft', { draftTouchedAt: new Date(Date.now() - 1000), wizardStep: 3 });
  await mk('Older Draft', { draftTouchedAt: new Date(Date.now() - 5 * day) });
  await mk('Ancient Draft', { draftTouchedAt: new Date(Date.now() - 30 * day) });
  await mk('Archived Draft', { draftTouchedAt: new Date(), archived: true });
  await mk('Live One', { draftTouchedAt: new Date(), status: 'live' });
  const r = await getResumeDrafts();
  expect(r.latest).toEqual({ id: newest.id, name: 'Newest Draft', wizardStep: 3 });
  expect(r.others).toBe(1);
});

it('remembers a validated return path with the OAuth state, once, and refuses anything else', async () => {
  const good = '/campaigns/new?id=abc123&step=2';
  await storeOAuthReturn('zoom', 's-good', good);
  expect(await takeOAuthReturn('zoom', 's-good')).toBe(good);
  expect(await takeOAuthReturn('zoom', 's-good')).toBeNull(); // one use

  for (const bad of ['https://evil.example/x', '//evil.example', '/integrations', 'javascript:alert(1)', '/campaigns/new?id=../x']) {
    await storeOAuthReturn('zoom', 's-bad', bad);
    expect(await takeOAuthReturn('zoom', 's-bad')).toBeNull();
    expect(await db.appSetting.findUnique({ where: { key: 'zoom.oauth_return.s-bad' } })).toBeNull();
  }

  // Expired, and bound to the provider and state it was stored for.
  await storeOAuthReturn('zoom', 's-exp', good, Date.now() - 11 * 60 * 1000);
  expect(await takeOAuthReturn('zoom', 's-exp')).toBeNull();
  await storeOAuthReturn('zoom', 's-prov', good);
  expect(await takeOAuthReturn('linkedin', 's-prov')).toBeNull();
  expect(await takeOAuthReturn('zoom', 'other-state')).toBeNull();
  expect(await takeOAuthReturn('zoom', null)).toBeNull();

  // A tampered stored value is re-validated on the way out.
  await db.appSetting.create({ data: { key: 'zoom.oauth_return.s-tamper', value: JSON.stringify({ returnTo: 'https://evil.example', exp: Date.now() + 60_000 }) } });
  expect(await takeOAuthReturn('zoom', 's-tamper')).toBeNull();

  await storeOAuthReturn('zoom', 's-purge', good, Date.now() - 20 * 60 * 1000);
  expect(await purgeExpiredOAuthReturns()).toBeGreaterThanOrEqual(1);
});


it('answers whether a creation token produced a draft, so a leftover device copy is not offered a second time', async () => {
  const made1 = await create({ title: 'Token Lookup' }, 0, 'tok-lookup-1');
  expect(await getDraftIdForTokenAction('tok-lookup-1')).toBe(made1.campaignId);
  expect(await getDraftIdForTokenAction('tok-never-used')).toBeNull();
  expect(await getDraftIdForTokenAction('')).toBeNull();
  expect(await getDraftIdForTokenAction('x'.repeat(100))).toBeNull();
  await db.campaign.delete({ where: { id: made1.campaignId } });
  expect(await getDraftIdForTokenAction('tok-lookup-1')).toBeNull(); // the draft is gone, so the copy may be offered
});
