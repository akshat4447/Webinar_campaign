import { it, expect, vi, beforeEach, afterAll } from 'vitest';
vi.mock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
import { startFakeZoom, FAKE_ZOOM_ALL_SCOPES } from '../fakes/zoomFake';

// Fetching a Zoom event's details through the same actions the wizard uses, against the fake Zoom server (which
// follows Zoom's documented behaviour, including the ":admin" scopes of a Server-to-Server app).
const fake = await startFakeZoom({ webinarAddOn: true });
process.env.ZOOM_OAUTH_BASE_URL = fake.oauthUrl;
process.env.ZOOM_API_BASE_URL = fake.apiUrl;
const { db } = await import('@/lib/db');
const { saveIntegrationConfig } = await import('@/lib/integrationConfig');
const { fetchZoomEventDetailsAction, listZoomMeetingsAction, linkZoomMeetingAction } = await import('@/lib/actions/zoom');
const { parseEventRef } = await import('@/lib/zoom/meetings');

const made: string[] = [];
const start = () => new Date(Date.now() + 3 * 864e5).toISOString();

beforeEach(async () => {
  fake.reset();
  fake.config.webinarAddOn = true;
  await db.appSetting.deleteMany({ where: { key: { startsWith: 'integration.zoom.' } } });
  await saveIntegrationConfig('zoom', { accountId: fake.config.accountId, clientId: fake.config.clientId, clientSecret: fake.config.clientSecret, hostEmail: fake.config.hostEmail });
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.appSetting.deleteMany({ where: { key: { startsWith: 'integration.zoom.' } } });
  await db.$disconnect();
  await fake.stop();
});

const noToken = () => db.appSetting.deleteMany({ where: { key: 'integration.zoom.accessToken' } });

it('reads a webinar by ID: topic, time, registration page, capacity and the host and panelists by name', async () => {
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'Big Webinar', start_time: start(), approval_type: 0, agenda: 'About things', duration: 90, registrants_restrict_number: 500 });
  fake.seedPanelists(w.id, [{ name: 'Priya Panelist', email: 'priya@example.com' }]);
  const r = await fetchZoomEventDetailsAction(String(w.id));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.meeting).toMatchObject({ id: String(w.id), topic: 'Big Webinar', type: 'webinar', duration: 90, capacity: 500, agenda: 'About things' });
  expect(r.meeting.registrationUrl).toMatch(/register/);
  expect(r.meeting.speakers!.map((s) => s.name)).toEqual(['Fake Host', 'Priya Panelist']);
});

it('reads a meeting by ID and does not invent a seat capacity for it', async () => {
  const m = fake.seedMeeting({ kind: 'meeting', topic: 'Small Meeting', start_time: start() });
  const r = await fetchZoomEventDetailsAction(String(m.id));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.meeting.capacity).toBeNull(); // it used to say 300
});

it('accepts an ID typed the way Zoom shows it, with spaces or hyphens, and a join link', async () => {
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'Spaced', start_time: start(), approval_type: 0 });
  const id = String(w.id);
  for (const typed of [`${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7)}`, `${id.slice(0, 3)}-${id.slice(3, 7)}-${id.slice(7)}`, `  ${id} `, `https://us02web.zoom.us/w/${id}?tk=abc`, `https://zoom.us/j/${id}?pwd=xyz`]) {
    const r = await fetchZoomEventDetailsAction(typed);
    expect(r.ok, typed).toBe(true);
  }
});

it('finds a webinar from its registration link, which does not contain the ID', async () => {
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'By Link', start_time: start(), approval_type: 0 });
  const first = await fetchZoomEventDetailsAction(String(w.id));
  if (!first.ok) throw new Error(first.error);
  const reg = first.meeting.registrationUrl!;
  expect(parseEventRef(reg).id).toBeNull(); // the link has a token, not an ID
  const r = await fetchZoomEventDetailsAction(reg);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.meeting.id).toBe(String(w.id));

  const mt = fake.seedMeeting({ kind: 'meeting', topic: 'Meeting By Link', start_time: start(), approval_type: 0 });
  const mFirst = await fetchZoomEventDetailsAction(String(mt.id));
  if (!mFirst.ok || !mFirst.meeting.registrationUrl) throw new Error('the fake meeting should have a registration page');
  const viaLink = await fetchZoomEventDetailsAction(mFirst.meeting.registrationUrl);
  expect(viaLink.ok).toBe(true);
  if (viaLink.ok) expect(viaLink.meeting.id).toBe(String(mt.id));
});

it('says plainly when a registration link matches nothing on the account', async () => {
  fake.seedMeeting({ kind: 'webinar', topic: 'Other', start_time: start(), approval_type: 0 });
  const r = await fetchZoomEventDetailsAction('https://zoom.us/webinar/register/WN_notOnThisAccount123');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/does not match any upcoming webinar or meeting/);
    expect(r.error).toMatch(/numeric webinar or meeting ID/);
  }
});

it('tells an ID that does not exist apart from every other failure, and names the connected account', async () => {
  const r = await fetchZoomEventDetailsAction('123456789012');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/No Zoom webinar or meeting with that ID/);
    expect(r.error).toContain(fake.config.hostEmail);
    expect(r.error).not.toMatch(/Could not fetch details for that Zoom event/);
  }
});

it('names the missing permission instead of saying the ID might be wrong', async () => {
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'Scoped', start_time: start(), approval_type: 0 });
  fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => !s.startsWith('webinar:read'));
  await noToken();
  const r = await fetchZoomEventDetailsAction(String(w.id));
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/Missing permissions/);
    expect(r.error).toMatch(/webinar:read:webinar/);
    expect(r.error).toMatch(/Server-to-Server/);
    expect(r.error).toMatch(/no reconnect is needed/);
  }
});

it('picks up scopes added to a Server-to-Server app without waiting for the cached token to expire', async () => {
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'Rescoped', start_time: start(), approval_type: 0 });
  fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => !s.startsWith('webinar:read'));
  await noToken();
  expect((await fetchZoomEventDetailsAction(String(w.id))).ok).toBe(false); // token cached with the old scopes
  fake.config.scopes = [...FAKE_ZOOM_ALL_SCOPES]; // scopes added in the Marketplace
  const r = await fetchZoomEventDetailsAction(String(w.id)); // no manual reconnect, no waiting
  expect(r.ok).toBe(true);
});

it('lists events, and says why when the account looks empty only because nothing could be read', async () => {
  fake.seedMeeting({ kind: 'webinar', topic: 'Listed Webinar', start_time: start(), approval_type: 0 });
  fake.seedMeeting({ kind: 'meeting', topic: 'Listed Meeting', start_time: start() });
  const ok = await listZoomMeetingsAction();
  expect(ok.ok && ok.meetings.map((m) => m.topic).sort()).toEqual(['Listed Meeting', '[Webinar] Listed Webinar']);

  // Only the webinar list is refused: the meetings still show, with the reason alongside.
  fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => !s.startsWith('webinar:read:list'));
  await noToken();
  const partial = await listZoomMeetingsAction();
  expect(partial.ok).toBe(true);
  if (partial.ok) {
    expect(partial.meetings.map((m) => m.topic)).toEqual(['Listed Meeting']);
    expect(partial.warning).toMatch(/webinar list/);
    expect(partial.warning).toMatch(/webinar:read:list_webinars/);
  }

  // Nothing can be read: that is an error with a reason, not "no upcoming meetings".
  fake.config.scopes = [];
  await noToken();
  const none = await listZoomMeetingsAction();
  expect(none.ok).toBe(false);
  if (!none.ok) expect(none.error).toMatch(/Missing permissions/);
});

it('an account with no webinar add-on is not an error: it just has meetings', async () => {
  fake.config.webinarAddOn = false;
  fake.seedMeeting({ kind: 'meeting', topic: 'Only Meetings', start_time: start() });
  const r = await listZoomMeetingsAction();
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.meetings.map((m) => m.topic)).toEqual(['Only Meetings']);
    expect(r.warning).toBeUndefined();
  }
});

it('linking an event reports the cause when Zoom cannot be read, and applies duration and the webinar\'s own timezone', async () => {
  const c = await db.campaign.create({ data: { name: 'Link Me', vertical: 'x', date: 'x', timezone: 'Europe/London' } });
  made.push(c.id);
  const w = fake.seedMeeting({ kind: 'webinar', topic: 'Linked Webinar', start_time: '2027-03-10T15:00:00Z', approval_type: 0, duration: 45 });
  const ok = await linkZoomMeetingAction(c.id, String(w.id));
  expect(ok.ok).toBe(true);
  const row = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
  expect(row).toMatchObject({ name: 'Linked Webinar', zoomMeetingId: String(w.id), durationMinutes: 45, zoomEventType: 'webinar' });
  expect(row.date).toContain('3:00 PM'); // the label is in the webinar's own zone (London), not the default

  fake.config.scopes = FAKE_ZOOM_ALL_SCOPES.filter((s) => !s.startsWith('webinar:read'));
  await noToken();
  const bad = await linkZoomMeetingAction(c.id, String(w.id));
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error).toMatch(/Missing permissions/);
});

it('reads the host\'s real name from their Zoom profile when the event has no contact name', async () => {
  const m = fake.seedMeeting({ kind: 'meeting', topic: 'Who Hosts', start_time: start() });
  const r = await fetchZoomEventDetailsAction(String(m.id));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.meeting.speakers![0].name).toBe('Fake Host');
});
