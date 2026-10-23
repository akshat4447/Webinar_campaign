// Restarting a stopped cadence, moving a launched webinar to a new date, and launching again: the three actions behind the
// Results page's Cadence Control. Each answers with a sentence the page can show, never a thrown error.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const readiness = vi.hoisted(() => ({ result: { ok: true, problems: [] as string[] } }));
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
vi.mock('@/lib/launchReadiness', () => ({
  getLaunchReadiness: vi.fn(async () => readiness.result),
  assertLaunchReady: vi.fn(async () => { if (!readiness.result.ok) throw new Error(`Launch blocked: ${readiness.result.problems.join(' ')}`); }),
}));
vi.mock('@/lib/lsqExclusions', () => ({ refreshLsqExclusions: vi.fn(async () => undefined) }));
vi.mock('@/lib/cadence', async (orig) => ({ ...(await orig<typeof import('@/lib/cadence')>()), processDueSends: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0, remaining: 0, dailyLimitReached: false, outsideSendWindow: false })) }));

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let actions: typeof import('@/lib/actions/schedule');
const created: string[] = [];
const DAY = 864e5;

async function webinar(over: Record<string, unknown> = {}) {
  const c = await db.campaign.create({
    data: { name: 'ZZ Cadence Lifecycle', vertical: 'Test', date: 'x', status: 'live', cadenceStatus: 'stopped', scheduledAt: new Date(Date.now() + 5 * DAY), zoomMeetingId: '123456789', ...over },
  });
  created.push(c.id);
  return c;
}
async function person(campaignId: string, n: number, over: Record<string, unknown> = {}) {
  return db.contact.create({ data: { campaignId, name: `Person ${n}`, email: `life${n}-${Math.random().toString(36).slice(2, 7)}@example.com`, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true, score: 80, ...over } });
}

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  actions = await import('@/lib/actions/schedule');
});
beforeEach(() => {
  readiness.result = { ok: true, problems: [] };
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe('restartCadenceAction', () => {
  it('resets a stopped cadence for a webinar still ahead: what was sent stays sent, what was waiting is set aside', async () => {
    const c = await webinar();
    const [a, b] = [await person(c.id, 1), await person(c.id, 2)];
    await db.cadenceSend.create({ data: { campaignId: c.id, contactId: a.id, stepKey: 'invite', dueAt: new Date(Date.now() - DAY), status: 'sent', sentAt: new Date() } });
    await db.cadenceSend.create({ data: { campaignId: c.id, contactId: b.id, stepKey: 'invite', dueAt: new Date(Date.now() + DAY), status: 'queued' } });
    const res = await actions.restartCadenceAction(c.id);
    expect(res).toEqual({ ok: true, skipped: 1 });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).cadenceStatus).toBe('not_started');
    expect((await db.cadenceSend.findFirstOrThrow({ where: { contactId: a.id } })).status).toBe('sent');
    expect((await db.cadenceSend.findFirstOrThrow({ where: { contactId: b.id } })).status).toBe('skipped');
  });

  it('says to reschedule first when the webinar date has passed, and changes nothing', async () => {
    const c = await webinar({ scheduledAt: new Date(Date.now() - DAY) });
    const res = await actions.restartCadenceAction(c.id);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/date has passed.*Reschedule/) });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).cadenceStatus).toBe('stopped');
  });

  it('only restarts a stopped cadence, and never a closed webinar', async () => {
    const running = await webinar({ cadenceStatus: 'running' });
    expect(await actions.restartCadenceAction(running.id)).toMatchObject({ ok: false, error: expect.stringMatching(/Only a stopped cadence/) });
    const done = await webinar({ status: 'completed' });
    expect(await actions.restartCadenceAction(done.id)).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
    expect(await actions.restartCadenceAction('does-not-exist')).toMatchObject({ ok: false });
  });
});

describe('rescheduleWebinarAction', () => {
  it('moves the webinar, and the sends still waiting on it, to the new date', async () => {
    const c = await webinar();
    const p = await person(c.id, 1);
    await db.cadenceStep.create({ data: { campaignId: c.id, key: 't1d', group: 'Reminders · registrants only', title: 'T-1 day reminder', timing: 'T-1d', channel: 'Email', desc: '', toggleable: true, enabled: true, anchor: 'webinar', offsetValue: -1, offsetUnit: 'days', trigger: 'registration' } });
    await db.cadenceSend.create({ data: { campaignId: c.id, contactId: p.id, stepKey: 't1d', dueAt: new Date(Date.now() + 4 * DAY), status: 'queued' } });
    const target = new Date(Date.now() + 20 * DAY);
    const local = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}T12:00`;
    const res = await actions.rescheduleWebinarAction(c.id, local);
    expect(res).toMatchObject({ ok: true, zoomLinked: true });
    const after = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.scheduledAt!.getTime()).toBeGreaterThan(Date.now() + 19 * DAY);
    const send = await db.cadenceSend.findFirstOrThrow({ where: { contactId: p.id } });
    expect(send.dueAt.getTime()).toBeCloseTo(after.scheduledAt!.getTime() - DAY, -4); // a day before the new date
    expect(await db.activityLogEntry.count({ where: { campaignId: c.id, text: { startsWith: 'Webinar rescheduled to' } } })).toBe(1);
  });

  it('refuses a date that is not ahead, an empty one, and a closed webinar', async () => {
    const c = await webinar();
    expect(await actions.rescheduleWebinarAction(c.id, '2020-01-01T10:00')).toMatchObject({ ok: false, error: expect.stringMatching(/still ahead/) });
    expect(await actions.rescheduleWebinarAction(c.id, '')).toMatchObject({ ok: false, error: expect.stringMatching(/Choose/) });
    const done = await webinar({ status: 'completed' });
    expect(await actions.rescheduleWebinarAction(done.id, '2099-01-01T10:00')).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).scheduledAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('says there is no Zoom event to change when none is linked', async () => {
    const c = await webinar({ zoomMeetingId: null });
    const res = await actions.rescheduleWebinarAction(c.id, '2099-01-01T10:00');
    expect(res).toMatchObject({ ok: true, zoomLinked: false });
  });
});

describe('launchCadenceAction', () => {
  it('gives back the reasons, as a list, when the webinar is not ready', async () => {
    readiness.result = { ok: false, problems: ['Approve at least one contact before launch.', 'Configure netcore.apiKey before sending.'] };
    const c = await webinar({ cadenceStatus: 'not_started' });
    const res = await actions.launchCadenceAction(c.id);
    expect(res).toEqual({ ok: false, error: 'This webinar is not ready to launch yet.', problems: readiness.result.problems });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).cadenceStatus).toBe('not_started');
  });

  it('launches a reset cadence, queues only what was never sent, and runs', async () => {
    const c = await webinar({ cadenceStatus: 'not_started' });
    const { provisionCampaignDefaults } = await import('@/lib/campaignDefaults');
    await provisionCampaignDefaults(c.id);
    await db.cadenceStep.updateMany({ where: { campaignId: c.id, key: { not: 'invite' } }, data: { enabled: false } });
    await db.cadenceStep.updateMany({ where: { campaignId: c.id, key: 'invite' }, data: { enabled: true } });
    const [sentTo, waiting] = [await person(c.id, 1), await person(c.id, 2)];
    await db.cadenceSend.create({ data: { campaignId: c.id, contactId: sentTo.id, stepKey: 'invite', dueAt: new Date(Date.now() - DAY), status: 'sent', sentAt: new Date() } });
    const res = await actions.launchCadenceAction(c.id);
    expect(res).toMatchObject({ ok: true, queued: 1 });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).cadenceStatus).toBe('running');
    expect(await db.cadenceSend.count({ where: { contactId: sentTo.id } })).toBe(1); // not sent a second time
    expect((await db.cadenceSend.findFirstOrThrow({ where: { contactId: waiting.id } })).status).toBe('queued');
  });

  it('answers in words, not an exception, when the cadence is not in a state to launch', async () => {
    const c = await webinar({ cadenceStatus: 'running' });
    const res = await actions.launchCadenceAction(c.id);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cannot launch in its current state/) });
  });
});

describe('a step added or changed after the cadence is running', () => {
  const GROUP = 'Pre-registration';
  const queuedFor = (campaignId: string, stepKey: string) => db.cadenceSend.findMany({ where: { campaignId, stepKey } });

  it('gets its audience at once: an Email step added to a launch group queues for every approved contact, once', async () => {
    const c = await webinar({ cadenceStatus: 'running', launchedAt: new Date(Date.now() - DAY) });
    const [a, b] = [await person(c.id, 1), await person(c.id, 2)];
    const stepId = await actions.addCadenceStepAction(c.id, GROUP, 'email');
    const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: stepId } });
    const sends = await queuedFor(c.id, step.key);
    expect(sends.map((s) => s.contactId).sort()).toEqual([a.id, b.id].sort());
    expect(sends.every((s) => s.status === 'queued')).toBe(true);
    // Saving the same step again never queues a second copy.
    await actions.updateStepScheduleAction(c.id, step.key, { offsetValue: 3, offsetUnit: 'days', anchor: 'launch', timing: '+3 days' });
    expect(await queuedFor(c.id, step.key)).toHaveLength(2);
    expect((await db.activityLogEntry.findMany({ where: { campaignId: c.id, text: { contains: 'Queued 2 send(s)' } } })).length).toBe(1);
  });

  it('"Instant" on a launch step means the moment of launch, so it is due now rather than silently dropped', async () => {
    const c = await webinar({ cadenceStatus: 'running', launchedAt: new Date(Date.now() - DAY) });
    const p = await person(c.id, 1);
    const stepId = await actions.addCadenceStepAction(c.id, GROUP, 'email');
    const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: stepId } });
    await db.cadenceSend.deleteMany({ where: { campaignId: c.id } });
    const res = await actions.updateStepScheduleAction(c.id, step.key, { offsetValue: 0, offsetUnit: 'hours', anchor: 'event', timing: 'Instant' });
    expect(res).toMatchObject({ ok: true });
    expect((await db.cadenceStep.findUniqueOrThrow({ where: { id: stepId } })).anchor).toBe('launch');
    const [send] = await queuedFor(c.id, step.key);
    expect(send).toMatchObject({ contactId: p.id, status: 'queued' });
    expect(send.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('switching a step back on queues it; a registrants-only step queues nothing for someone who has not registered', async () => {
    const c = await webinar({ cadenceStatus: 'running', launchedAt: new Date(Date.now() - DAY) });
    const p = await person(c.id, 1);
    const reg = await actions.addCadenceStepAction(c.id, 'Reminders · registrants only', 'email');
    const regStep = await db.cadenceStep.findUniqueOrThrow({ where: { id: reg } });
    expect(regStep.trigger).toBe('registration');
    expect(await queuedFor(c.id, regStep.key)).toHaveLength(0);

    const launchId = await actions.addCadenceStepAction(c.id, GROUP, 'email');
    const launchStep = await db.cadenceStep.findUniqueOrThrow({ where: { id: launchId } });
    await db.cadenceSend.deleteMany({ where: { campaignId: c.id, stepKey: launchStep.key } });
    await db.cadenceStep.update({ where: { id: launchId }, data: { enabled: false } });
    await actions.toggleCadenceStepAction(c.id, launchStep.key, true);
    expect((await queuedFor(c.id, launchStep.key)).map((s) => s.contactId)).toEqual([p.id]);
  });

  it('does nothing on a cadence that has not launched or has stopped (launch itself queues, restart handles the rest)', async () => {
    const draft = await webinar({ cadenceStatus: 'not_started' });
    await person(draft.id, 1);
    const stepId = await actions.addCadenceStepAction(draft.id, GROUP, 'email');
    const step = await db.cadenceStep.findUniqueOrThrow({ where: { id: stepId } });
    expect(await queuedFor(draft.id, step.key)).toHaveLength(0);
  });
});

describe('restoreCadenceStepAction', () => {
  const removedInvite = (campaignId: string) =>
    db.cadenceStep.create({ data: { campaignId, key: 'invite', group: 'Pre-registration', title: 'Initial invite', timing: 'Day 0', channel: 'Email', desc: 'First invite', enabled: false, removedAt: new Date(), trigger: 'launch', anchor: 'launch', offsetValue: 0, offsetUnit: 'days' } });

  it('brings a removed built-in step back, switched on, and queues it for the people already in the cadence', async () => {
    const c = await webinar({ cadenceStatus: 'running', launchedAt: new Date(Date.now() - DAY) });
    const p = await person(c.id, 1);
    const step = await removedInvite(c.id);
    const res = await actions.restoreCadenceStepAction(c.id, step.id);
    expect(res).toEqual({ ok: true, queued: 1 });
    expect(await db.cadenceStep.findUniqueOrThrow({ where: { id: step.id } })).toMatchObject({ removedAt: null, enabled: true });
    expect(await db.cadenceSend.findMany({ where: { campaignId: c.id, stepKey: 'invite' } })).toMatchObject([{ contactId: p.id, status: 'queued' }]);
  });

  it('answers in words for a step that is not removed, a stopped cadence and a closed webinar', async () => {
    const c = await webinar({ cadenceStatus: 'running' });
    const live = await db.cadenceStep.create({ data: { campaignId: c.id, key: 'live', group: 'Pre-registration', title: 'Live', timing: 'Day 0', channel: 'Email', desc: '' } });
    expect(await actions.restoreCadenceStepAction(c.id, live.id)).toMatchObject({ ok: false, error: expect.stringMatching(/not removed/) });
    const stopped = await webinar({ cadenceStatus: 'stopped' });
    const s = await removedInvite(stopped.id);
    expect(await actions.restoreCadenceStepAction(stopped.id, s.id)).toMatchObject({ ok: false, error: expect.stringMatching(/stopped/) });
    const done = await webinar({ status: 'completed' });
    expect(await actions.restoreCadenceStepAction(done.id, (await removedInvite(done.id)).id)).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
  });
});
