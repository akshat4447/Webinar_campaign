import { zoomRequest, zoomIsConfigured, zoomHostUser, ZoomError } from './client';

export interface ZoomSpeaker {
  name: string;
  email?: string | null;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  isPrimary?: boolean;
  joinUrl?: string | null;
}

export interface ZoomMeeting {
  id: string;
  topic: string;
  startTime: string | null;
  duration: number | null;
  timezone?: string;
  joinUrl: string;
  /** Zoom's own hosted registration page, present when registration is enabled. */
  registrationUrl?: string | null;
  /**
   * Whether Zoom will accept add-registrant calls for this event. False when the event was
   * created/left with approval_type 2 ("no registration required") — every registrant call
   * would then fail with "registration not enabled" until it is switched on.
   */
  registrationEnabled?: boolean;
  channelRegistrationLinks?: {
    email?: string;
    whatsapp?: string;
    sms?: string;
    linkedin?: string;
    email_campaign?: string;
    sdr_sales?: string;
    third_parties?: string;
    linkedin_event?: string;
    website?: string;
  };
  capacity?: number | null;
  agenda?: string | null;
  type?: 'webinar' | 'meeting';
  speakers?: ZoomSpeaker[];
  host?: {
    name: string;
    email: string;
    title?: string | null;
  };
  settings?: {
    approvalType?: number;
    autoRecording?: string;
    questionAnswer?: boolean;
    practiceSession?: boolean;
  };
}

export interface ZoomParticipant {
  name: string;
  email: string | null;
  durationMinutes: number;
}

export function buildZoomTrackingLinks(regUrl: string) {
  const base = regUrl.replace(/\?.*$/, '');
  return {
    email: `${base}?source=email_campaign`,
    whatsapp: `${base}?source=whatsapp`,
    sms: `${base}?source=sms`,
    linkedin: `${base}?source=linkedin`,
    email_campaign: `${base}?source=email_campaign`,
    sdr_sales: `${base}?source=sdr_sales`,
    third_parties: `${base}?source=third_parties`,
    linkedin_event: `${base}?source=linkedin_event`,
    website: `${base}?source=website`,
  };
}

interface ZoomListResponse {
  next_page_token?: string;
  meetings?: { id: number | string; topic: string; start_time?: string; duration?: number; timezone?: string; join_url: string; agenda?: string }[];
}

interface ZoomWebinarListResponse {
  next_page_token?: string;
  webinars?: { id: number | string; topic: string; start_time?: string; duration?: number; timezone?: string; join_url: string; registration_url?: string; agenda?: string }[];
}

/** Zoom lists are paged (max 300/page); bound the walk so a huge account cannot stall a sync tick. */
const MAX_LIST_PAGES = 10;

/** Follows `next_page_token` for a Zoom list endpoint, returning every page's response. */
export async function zoomListAllPages<T extends { next_page_token?: string }>(path: string, pageSize = 100): Promise<T[]> {
  const pages: T[] = [];
  let token = '';
  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await zoomRequest<T>(`${path}${sep}page_size=${pageSize}${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`);
    pages.push(page);
    token = page?.next_page_token ?? '';
    if (!token) break;
  }
  return pages;
}

/** What failed when Zoom would not answer, in terms the operator can act on. */
export type ZoomFailureKind = 'not_found' | 'scope' | 'auth' | 'plan' | 'rate' | 'other';

export function classifyZoomFailure(err: unknown): ZoomFailureKind {
  if (!(err instanceof ZoomError)) return 'other';
  const text = err.message;
  if (err.code === 4711 || /does not contain scopes/i.test(text)) return 'scope';
  if (err.status === 401 || err.code === 124) return 'auth';
  if (err.status === 429) return 'rate';
  // 3001 "does not exist", 300 "Invalid ... ID": there is no such event for this connection.
  if (err.status === 404 || err.code === 3001 || err.code === 300) return 'not_found';
  // The account has no webinar licence: whatever was asked is not a webinar here.
  if (err.code === 3161 || /webinar plan|webinar.*(not|isn't).*(enabled|available)|Webinar plan is missing/i.test(text)) return 'plan';
  return 'other';
}

/** A one-line, actionable reason for a Zoom failure. */
export function describeZoomFailure(err: unknown, what: string): string {
  const kind = classifyZoomFailure(err);
  const raw = err instanceof Error ? err.message : String(err);
  switch (kind) {
    case 'scope':
      return `Zoom did not allow reading ${what}: ${raw.replace(/^Zoom [A-Z]+ \S+ failed: \d+ /, '').slice(0, 400)}`;
    case 'auth':
      if (/Client ID|Client Secret|no longer accepts|renew|refresh token/i.test(raw)) return raw;
      return `Zoom rejected the saved connection (HTTP 401) while reading ${what}. Reconnect Zoom on the Integrations page.`;
    case 'rate':
      return `Zoom is rate limiting this account while reading ${what}. Wait a minute and try again.`;
    default:
      return `Zoom could not read ${what}: ${raw.slice(0, 300)}`;
  }
}

/** Upcoming meetings and webinars on the connected account, with a reason for anything that could not be read. */
export async function listUpcomingMeetingsDetailed(): Promise<{ meetings: ZoomMeeting[]; warnings: string[] }> {
  if (!(await zoomIsConfigured())) throw new ZoomError('Zoom is not connected.');

  const results: ZoomMeeting[] = [];
  const warnings: string[] = [];
  const failures: unknown[] = [];

  // 1. Fetch Webinars from Zoom
  try {
    const host = await zoomHostUser();
    const webinarPages = await zoomListAllPages<ZoomWebinarListResponse>(`/users/${host}/webinars`);
    for (const webinarJson of webinarPages) {
      for (const w of webinarJson?.webinars ?? []) {
        const regUrl = w.registration_url || null;
        results.push({
          id: String(w.id),
          topic: `[Webinar] ${w.topic}`,
          startTime: w.start_time ?? null,
          duration: w.duration ?? null,
          timezone: w.timezone,
          joinUrl: w.join_url,
          registrationUrl: regUrl,
          channelRegistrationLinks: regUrl ? buildZoomTrackingLinks(regUrl) : undefined,
          agenda: w.agenda ?? null,
          type: 'webinar',
        });
      }
    }
  } catch (err) {
    // An account without the webinar add-on simply has no webinars. Anything else is a real problem, and is
    // reported: it used to reach only the server log, so the page said "no upcoming meetings" instead.
    if (classifyZoomFailure(err) !== 'plan') {
      failures.push(err);
      warnings.push(describeZoomFailure(err, 'the webinar list'));
    }
  }

  // 2. Fetch Meetings from Zoom
  try {
    const meetingPages = await zoomListAllPages<ZoomListResponse>(`/users/${await zoomHostUser()}/meetings?type=upcoming`);
    for (const meetingJson of meetingPages) {
      for (const m of meetingJson?.meetings ?? []) {
        results.push({
          id: String(m.id),
          topic: m.topic,
          startTime: m.start_time ?? null,
          duration: m.duration ?? null,
          timezone: m.timezone,
          joinUrl: m.join_url,
          agenda: m.agenda ?? null,
          type: 'meeting',
        });
      }
    }
  } catch (err) {
    failures.push(err);
    warnings.push(describeZoomFailure(err, 'the meeting list'));
  }

  // When nothing could be read at all the caller must be able to tell that apart from an empty account.
  if (results.length === 0 && failures.length > 0) throw new ZoomError(warnings[0], undefined, undefined);
  return { meetings: results, warnings };
}

/** Upcoming meetings and webinars on the connected account. */
export async function listUpcomingMeetings(): Promise<ZoomMeeting[]> {
  return (await listUpcomingMeetingsDetailed()).meetings;
}

/**
 * What a person typed or pasted to name a Zoom event: a numeric ID (with or without spaces or hyphens), a join
 * link with the ID in it, or a registration link, which carries only an opaque token that is NOT the event's ID.
 */
export function parseEventRef(input: string): { id: string | null; token: string | null } {
  const raw = (input ?? '').trim();
  if (!raw) return { id: null, token: null };
  const explicit = /\/(?:j|w|s|wc\/join|webinar\/join)\/(\d{9,11})(?![\d])/.exec(raw);
  if (explicit) return { id: explicit[1], token: null };
  const digits = raw.replace(/[\s-]/g, '');
  if (/^\d{9,11}$/.test(digits)) return { id: digits, token: null };
  const registration = /\/(?:webinar|meeting)\/register\/([A-Za-z0-9_-]+)/.exec(raw) ?? /\b(WN_[A-Za-z0-9_-]+)/.exec(raw);
  if (registration) return { id: null, token: registration[1] };
  const loose = /(?<!\d)(\d{9,11})(?!\d)/.exec(raw.replace(/(?<=\d)[ -](?=\d)/g, ''));
  return { id: loose ? loose[1] : null, token: null };
}

/**
 * Zoom's API cannot look an event up from its registration link: the token in the link is not an ID. The link
 * is matched against the registration pages of the account's own upcoming events instead.
 */
async function findEventByRegistrationToken(token: string): Promise<string | null> {
  const { meetings } = await listUpcomingMeetingsDetailed();
  const direct = meetings.find((m) => m.registrationUrl?.includes(token));
  if (direct) return direct.id;
  // Neither list reliably carries registration pages, so look at each upcoming event's own details (webinars
  // first: they are the ones that have registration pages most of the time). Bounded, so a large account cannot stall this.
  const candidates = [...meetings.filter((x) => x.type === 'webinar'), ...meetings.filter((x) => x.type !== 'webinar')].slice(0, 40);
  for (const m of candidates) {
    try {
      const d = await zoomRequest<{ registration_url?: string }>(`/${m.type === 'webinar' ? 'webinars' : 'meetings'}/${encodeURIComponent(m.id)}`);
      if (d.registration_url?.includes(token)) return m.id;
    } catch {
      // one unreadable event must not stop the search
    }
  }
  return null;
}

const titleCase = (s: string) => s.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** The host's real name (and job title and company, when Zoom has them): the contact name, else the Zoom profile, else the email. */
async function hostProfile(hostId: string | undefined, fallbackEmail: string | undefined, contactName: string | undefined) {
  let name = contactName?.trim() || '';
  let title: string | null = null;
  let company: string | null = null;
  if (hostId) {
    try {
      const u = await zoomRequest<{ display_name?: string; first_name?: string; last_name?: string; job_title?: string; company?: string }>(`/users/${encodeURIComponent(hostId)}`);
      if (!name) name = u.display_name?.trim() || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      title = u.job_title?.trim() || null;
      company = u.company?.trim() || null;
    } catch {
      // The user scope may not be granted; the contact name or email below still gives a name.
    }
  }
  if (!name && fallbackEmail) name = titleCase(fallbackEmail.split('@')[0]);
  return { name, title, company };
}

/**
 * Directly fetches meeting or webinar details by ID, join link or registration link.
 * Automatically extracts speakers, panelists, registration links, and capacity.
 *
 * Returns null only when Zoom genuinely has no such event for this connection. Anything else (missing scopes, a
 * rejected token, a rate limit, a registration link that matches nothing) is thrown with a reason, instead of
 * collapsing into the same "could not fetch" answer.
 */
export async function getZoomEventDetails(idOrUrl: string): Promise<ZoomMeeting | null> {
  if (!idOrUrl || !idOrUrl.trim()) return null;
  const ref = parseEventRef(idOrUrl);
  let eventId = ref.id;
  if (!eventId && ref.token) {
    eventId = await findEventByRegistrationToken(ref.token);
    if (!eventId) {
      throw new ZoomError(
        "That registration link does not match any upcoming webinar or meeting on the connected Zoom account. Zoom's API cannot look an event up from its registration link alone, so paste the numeric webinar or meeting ID, or choose the event from the list. If it is hosted by someone else, connect that Zoom account."
      );
    }
  }
  if (!eventId) eventId = idOrUrl.trim();

  let webinarError: unknown = null;
  try {
    const w = await fetchWebinarDetails(eventId);
    if (w) return w;
  } catch (err) {
    webinarError = err;
  }

  let meetingError: unknown = null;
  try {
    const m = await fetchMeetingDetails(eventId);
    if (m) return m;
  } catch (err) {
    meetingError = err;
  }

  // Both said "no such event" (or "no webinar licence"): genuinely not there.
  const benign = (e: unknown) => e === null || ['not_found', 'plan'].includes(classifyZoomFailure(e));
  if (benign(webinarError) && benign(meetingError)) return null;
  // Otherwise report the cause that can be acted on. A webinar-scope failure matters even when the meeting lookup
  // says "not found", because the ID may well be a webinar.
  const order: ZoomFailureKind[] = ['scope', 'auth', 'rate', 'other'];
  const candidates = [webinarError, meetingError].filter((e): e is unknown => e !== null && !benign(e));
  candidates.sort((x, y) => order.indexOf(classifyZoomFailure(x)) - order.indexOf(classifyZoomFailure(y)));
  throw new ZoomError(describeZoomFailure(candidates[0], `event ${eventId}`), candidates[0] instanceof ZoomError ? candidates[0].status : undefined, candidates[0] instanceof ZoomError ? candidates[0].code : undefined);
}

async function fetchWebinarDetails(eventId: string): Promise<ZoomMeeting | null> {
  const w = await zoomRequest<{
    id: number | string;
    host_id?: string;
    topic: string;
    start_time?: string;
    duration?: number;
    timezone?: string;
    join_url: string;
    registration_url?: string;
    agenda?: string;
    host_email?: string;
    settings?: {
      contact_name?: string;
      contact_email?: string;
      registrants_restrict_number?: number;
      approval_type?: number;
      auto_recording?: string;
      question_and_answer?: { enable?: boolean };
      practice_session?: boolean;
    };
  }>(`/webinars/${encodeURIComponent(eventId)}`);
  if (!w?.id) return null;

  // Panelists. Scope might be missing or there might be none: non-fatal.
  let panelists: Array<{ name?: string; email?: string; join_url?: string; name_tag_name?: string }> = [];
  try {
    const pJson = await zoomRequest<{ panelists?: Array<{ name?: string; email?: string; join_url?: string; name_tag_name?: string }> }>(`/webinars/${encodeURIComponent(eventId)}/panelists`);
    panelists = pJson?.panelists ?? [];
  } catch {
    // non-fatal
  }

  const hostEmail = w.settings?.contact_email || w.host_email;
  const host = await hostProfile(w.host_id, hostEmail, w.settings?.contact_name);
  const hostName = host.name || 'Webinar Host';

  const speakers: ZoomSpeaker[] = [
    { name: hostName, email: hostEmail, title: host.title || 'Host & Keynote Speaker', company: host.company, isPrimary: true },
    ...panelists.map((p, idx) => ({
      name: p.name || p.name_tag_name || `Panelist ${idx + 1}`,
      email: p.email,
      title: 'Panelist / Speaker',
      isPrimary: false,
      joinUrl: p.join_url,
    })),
  ];

  const regUrl = w.registration_url || null;
  const capacity = w.settings?.registrants_restrict_number && w.settings.registrants_restrict_number > 0 ? w.settings.registrants_restrict_number : null;

  return {
    id: String(w.id),
    topic: w.topic,
    startTime: w.start_time ?? null,
    duration: w.duration ?? null,
    timezone: w.timezone,
    joinUrl: w.join_url,
    registrationUrl: regUrl,
    channelRegistrationLinks: regUrl ? buildZoomTrackingLinks(regUrl) : undefined,
    registrationEnabled: w.settings?.approval_type !== 2,
    capacity,
    agenda: w.agenda ?? null,
    type: 'webinar',
    speakers,
    host: { name: hostName, email: hostEmail || '', title: host.title || 'Host & Keynote Speaker' },
    settings: {
      approvalType: w.settings?.approval_type,
      autoRecording: w.settings?.auto_recording,
      questionAnswer: w.settings?.question_and_answer?.enable,
      practiceSession: w.settings?.practice_session,
    },
  };
}

async function fetchMeetingDetails(eventId: string): Promise<ZoomMeeting | null> {
  const m = await zoomRequest<{
    id: number | string;
    host_id?: string;
    topic: string;
    start_time?: string;
    duration?: number;
    timezone?: string;
    join_url: string;
    registration_url?: string;
    agenda?: string;
    host_email?: string;
    settings?: { contact_name?: string; contact_email?: string; approval_type?: number };
  }>(`/meetings/${encodeURIComponent(eventId)}`);
  if (!m?.id) return null;

  const host = await hostProfile(m.host_id, m.host_email, m.settings?.contact_name);
  const hostName = host.name || 'Meeting Host';
  return {
    id: String(m.id),
    topic: m.topic,
    startTime: m.start_time ?? null,
    duration: m.duration ?? null,
    timezone: m.timezone,
    joinUrl: m.join_url,
    registrationUrl: m.registration_url ?? null,
    // approval_type 2 = "no registration required": registrant calls would all fail.
    registrationEnabled: m.settings?.approval_type !== 2,
    agenda: m.agenda ?? null,
    type: 'meeting',
    // A meeting has no seat limit to read here (its participant ceiling comes from the host's plan). It used to
    // report 300, a number Zoom never said, which then appeared as the webinar's capacity.
    capacity: null,
    speakers: [{ name: hostName, email: m.host_email, title: host.title || 'Meeting Host', company: host.company, isPrimary: true }],
    host: { name: hostName, email: m.host_email || '' },
  };
}

export interface CreateMeetingInput {
  topic: string;
  startTime: Date | null;
  durationMinutes?: number;
  kind?: 'meeting' | 'webinar';
  agenda?: string;
  /** IANA timezone for the meeting (Zoom displays it to registrants). */
  timezone?: string;
}

/**
 * Create a meeting on the connected account WITH REGISTRATION ENABLED.
 *
 * Zoom's default is approval_type 2 ("no registration required"); on such a meeting every
 * add-registrant call fails with "registration not enabled", so personal join links and
 * registrant sync could never work. approval_type 0 = register and auto-approve.
 * Registrant email notifications are off because the cadence sends its own confirmation.
 */
export async function createMeeting(input: CreateMeetingInput): Promise<ZoomMeeting> {

  const host = await zoomHostUser();
  const created = await zoomRequest<{
    id: number | string;
    topic: string;
    start_time?: string;
    duration?: number;
      timezone?: string;
    join_url: string;
    registration_url?: string;
    settings?: { approval_type?: number };
  }>(`/users/${host}/${input.kind === 'webinar' ? 'webinars' : 'meetings'}`, {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic,
      // 2 = scheduled meeting. Webinars (type 5) need the paid add-on, and
      // failing over to a meeting is better than failing outright.
      type: input.kind === 'webinar' ? 5 : 2,
      start_time: input.startTime?.toISOString(),
      duration: input.durationMinutes ?? 60,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      agenda: input.agenda?.slice(0, 2000),
      settings: {
        join_before_host: false,
        waiting_room: false,
        approval_type: 0,
        registration_type: 1,
        registrants_email_notification: false,
        registrants_confirmation_email: false,
      },
    }),
  });

  return {
    id: String(created.id),
    topic: created.topic,
    type: input.kind || 'meeting',
    timezone: input.timezone,
    startTime: created.start_time ?? null,
    duration: created.duration ?? null,
    joinUrl: created.join_url,
    registrationUrl: created.registration_url ?? null,
    // Zoom silently ignores the setting for an unlicensed host — trust the response, not the request.
    registrationEnabled: created.settings?.approval_type !== undefined ? created.settings.approval_type !== 2 : Boolean(created.registration_url),

  };
}

export type ZoomEventKind = 'meeting' | 'webinar';

/**
 * Switch registration on for an event created elsewhere (approval_type 2 -> 0). Needs the
 * `meeting:update:meeting` / `webinar:update:webinar` scope. Returns Zoom's registration page URL.
 */
export async function enableZoomRegistration(id: string, kind: ZoomEventKind): Promise<{ ok: boolean; registrationUrl?: string | null; error?: string }> {
  if (!(await zoomIsConfigured())) return { ok: false, error: 'Zoom is not connected.' };
  const base = kind === 'webinar' ? 'webinars' : 'meetings';
  try {
    await zoomRequest(`/${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ settings: { approval_type: 0, registration_type: 1 } }) });
    const after = await zoomRequest<{ registration_url?: string; settings?: { approval_type?: number } }>(`/${base}/${encodeURIComponent(id)}`);
    if (after.settings?.approval_type === 2) return { ok: false, error: 'Zoom did not turn registration on. The host must be a Licensed user (Pro or higher).' };
    return { ok: true, registrationUrl: after.registration_url ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface ZoomParticipantsResponse {
  participants?: { name?: string; user_email?: string; duration?: number }[];
  next_page_token?: string;
}

/**
 * Attendance for a finished meeting.
 *
 * Deliberately the Meetings API's /past_meetings/.../participants (granular
 * scope meeting:read:list_past_participants), not the Reports API's
 * /report/meetings/.../participants — that one only grants via
 * report:read:list_meeting_participants:admin or :master, which a
 * User-managed OAuth app can't get for a normal (non-admin) connected
 * account. This endpoint is what an individual Zoom user can actually
 * authorize for their own past meetings.
 */
export async function fetchParticipants(meetingId: string, kind: ZoomEventKind = 'meeting'): Promise<ZoomParticipant[]> {
  if (!(await zoomIsConfigured())) throw new ZoomError('Zoom is not connected.');

  const out: ZoomParticipant[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ page_size: '300', ...(pageToken ? { next_page_token: pageToken } : {}) });
    const json = await zoomRequest<ZoomParticipantsResponse>(`/${kind === 'webinar' ? 'past_webinars' : 'past_meetings'}/${encodeURIComponent(meetingId)}/participants?${qs}`);
    for (const p of json.participants ?? []) {
      out.push({
        name: p.name ?? '',
        email: p.user_email || null,
        durationMinutes: (p.duration ?? 0) / 60,
      });
    }
    pageToken = json.next_page_token ?? '';
  } while (pageToken);

  return out;
}

export type ZoomRegistrantFailure =
  | 'registration_not_enabled'
  | 'scope_missing'
  | 'rate_limited'
  | 'not_found'
  | 'unauthorized'
  | 'host_not_licensed'
  | 'capacity'
  | 'validation'
  | 'no_join_url'
  | 'unknown';

export interface ZoomRegistrantResult {
  ok: boolean;
  joinUrl?: string;
  registrantId?: string;
  error?: string;
  /** Machine-readable cause, so the UI can say exactly what to fix. */
  reason?: ZoomRegistrantFailure;
  /** Which API family accepted the registrant. */
  eventType?: ZoomEventKind;
}

/** Maps a Zoom error to a stable reason (Zoom's own `code` first, message text as fallback). */
export function classifyZoomRegistrantError(err: unknown): ZoomRegistrantFailure {
  const e = err instanceof ZoomError ? err : null;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('does not contain scopes')) return 'scope_missing';
  if (e?.code === 3027 || msg.includes('registration has not been enabled') || msg.includes('registration not enabled')) return 'registration_not_enabled';
  if (e?.status === 429) return 'rate_limited';
  if (e?.status === 401 || e?.status === 403) return 'unauthorized';
  // Zoom reuses code 3001 for several different problems, so the message decides BEFORE the code does:
  // "registrant limit reached" is a capacity problem even though it shares the code with "not found".
  if (msg.includes('maximum') || msg.includes('capacity') || msg.includes('registrant limit') || msg.includes('registrants exceed') || msg.includes('limit reached')) return 'capacity';
  if (e?.status === 404 || e?.code === 3001 || msg.includes('does not exist') || msg.includes('not found')) return 'not_found';
  if (msg.includes('licen')) return 'host_not_licensed';
  if (e?.status === 400 || e?.code === 300 || msg.includes('validation')) return 'validation';
  return 'unknown';
}

/** Operator-facing explanation + the concrete fix for each failure. */
export function explainZoomRegistrantFailure(reason: ZoomRegistrantFailure): string {
  switch (reason) {
    case 'registration_not_enabled':
      return 'Registration is switched off on this Zoom event (approval type "no registration required"). Use "Enable registration" on the webinar setup, or turn on Registration → Required in Zoom.';
    case 'scope_missing':
      return 'The Zoom app is missing the registrant scope (meeting:write:registrant / webinar:write:registrant). Add it in the Zoom Marketplace app, then reconnect Zoom.';
    case 'rate_limited':
      return 'Zoom is rate limiting requests. The registration will be retried automatically.';
    case 'not_found':
      return 'Zoom could not find this meeting or webinar — it may have been deleted or the id is wrong. Relink the Zoom event.';
    case 'unauthorized':
      return 'Zoom rejected the saved credentials. Reconnect Zoom on the Integrations page.';
    case 'host_not_licensed':
      return 'The Zoom host is not a Licensed user. Registration requires a Pro (or higher) licence.';
    case 'capacity':
      return 'The Zoom event reached its registrant limit (4,999 for meetings).';
    case 'validation':
      return 'Zoom rejected the registrant details (for example a missing required registration question or an invalid email).';
    case 'no_join_url':
      return 'Zoom accepted the registrant but returned no personal join link.';
    default:
      return 'Zoom could not register this person. See the details in the activity log.';
  }
}

/**
 * Register an attendee for a Zoom meeting or webinar and retrieve their personal join URL.
 *
 * `eventType` should be passed whenever it is known (it is stored on the campaign). Only when
 * it is unknown do we probe — and then ONLY on a "not found" answer, never on any error, so a
 * rate limit, a missing scope or "registration not enabled" is reported as what it is instead of
 * being masked by a second, misleading call.
 *
 * Zoom answers a repeat registration for the same email with the existing registrant, so this is
 * safe to call again.
 */
export async function addZoomRegistrant(
  meetingId: string,
  registrant: { email: string; firstName: string; lastName?: string },
  opts: { eventType?: ZoomEventKind } = {}
): Promise<ZoomRegistrantResult> {
  if (!meetingId) return { ok: false, error: 'Meeting ID is required', reason: 'not_found' };


  const body = JSON.stringify({ email: registrant.email, first_name: registrant.firstName || 'Attendee', last_name: registrant.lastName || '' });
  const tryKind = async (kind: ZoomEventKind): Promise<ZoomRegistrantResult> => {
    const base = kind === 'webinar' ? 'webinars' : 'meetings';
    const res = await zoomRequest<{ id?: number | string; join_url?: string; registrant_id?: string }>(`/${base}/${encodeURIComponent(meetingId)}/registrants`, {
      method: 'POST',
      body,
    });
    if (!res?.join_url) return { ok: false, reason: 'no_join_url', error: explainZoomRegistrantFailure('no_join_url'), eventType: kind };
    return { ok: true, joinUrl: res.join_url, registrantId: String(res.registrant_id || res.id || ''), eventType: kind };
  };

  const order: ZoomEventKind[] = opts.eventType ? [opts.eventType] : ['meeting', 'webinar'];
  let last: ZoomRegistrantResult = { ok: false, reason: 'unknown', error: 'Could not obtain personalized Zoom join link' };
  for (const kind of order) {
    try {
      return await tryKind(kind);
    } catch (err) {
      const reason = classifyZoomRegistrantError(err);
      last = { ok: false, reason, error: `${explainZoomRegistrantFailure(reason)} (${err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)})`, eventType: kind };
      if (reason !== 'not_found') return last; // only a genuine "no such event" justifies trying the other API family
    }
  }
  return last;
}
