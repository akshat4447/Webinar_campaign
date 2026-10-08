// A local, in-process fake of Zoom: OAuth (zoom.us/oauth/*), REST API v2
// (api.zoom.us/v2/*) and a signed-webhook sender. It exists so the app's real
// Zoom client (lib/zoom/*) can be exercised over real HTTP, with fault
// injection, without a real Zoom account (see docs/MASTER_PLAN.md, D-TENANT).
//
// Wire it up with:
//   ZOOM_OAUTH_BASE_URL = fake.oauthUrl      (token = <base>/oauth/token)
//   ZOOM_API_BASE_URL   = fake.apiUrl        (includes /v2)
//
// The fake is written to mimic REAL Zoom behaviour, including its traps
// (default approval_type 2 = "no registration", silently ignored registration
// settings for unlicensed hosts, rotating refresh tokens, S2S tokens that
// cannot use `me`, no tracking-source API, ...). README.zoom.md lists every
// behaviour that is an assumption rather than a documented fact.
//
// Node built-ins only. No dependency on app code (signatures are computed
// independently so the app's verifier is tested against an independent
// implementation).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';

// ───────────────────────────── public types ─────────────────────────────

export interface FakeZoomOptions {
  /** 0 / omitted = ephemeral port. */
  port?: number;
  clientId?: string;
  clientSecret?: string;
  accountId?: string;
  hostEmail?: string;
  /** Licensed (Pro+) host? When false Zoom silently ignores registration settings. Default true. */
  hostLicensed?: boolean;
  /** Webinars add-on on the account? Default false (webinar endpoints answer "Webinar plan is missing"). */
  webinarAddOn?: boolean;
  /** Scopes granted to every NEW token. Default: every scope the fake knows. */
  scopes?: string[];
  /** Registrant cap per event. Default 4999 (Zoom's meeting cap). */
  maxRegistrants?: number;
  /** Access-token lifetime in seconds. Default 3600. */
  tokenTtlSec?: number;
  /** Server-side maximum page size (real Zoom: 300). Lower it to force pagination with small data. */
  maxPageSize?: number;
  /** Per-second request cap for the REST API (429 + Retry-After above it). */
  rateLimit?: { perSecond: number } | null;
  /** When true the token endpoint only accepts codes issued by /oauth/authorize (single use) and a matching redirect_uri. Default false: any code is accepted. */
  strictAuthCodes?: boolean;
}

/** Live, mutable configuration (restored to the start options by reset()). */
export interface FakeZoomConfig {
  clientId: string;
  clientSecret: string;
  accountId: string;
  hostEmail: string;
  hostLicensed: boolean;
  webinarAddOn: boolean;
  scopes: string[];
  maxRegistrants: number;
  tokenTtlSec: number;
  maxPageSize: number;
  rateLimit: { perSecond: number } | null;
  strictAuthCodes: boolean;
}

export type FakeEventKind = 'meeting' | 'webinar';

export interface FakeMeeting {
  id: number;
  uuid: string;
  kind: FakeEventKind;
  /** 2 = scheduled meeting, 5 = webinar. */
  type: number;
  host_id: string;
  host_email: string;
  topic: string;
  start_time?: string;
  duration: number;
  timezone: string;
  agenda: string;
  created_at: string;
  status: 'waiting' | 'started' | 'ended';
  end_time?: string;
  join_url: string;
  start_url: string;
  password: string;
  registrationToken: string;
  settings: Record<string, unknown> & { approval_type: number; registration_type: number };
}

export interface FakeRegistrant {
  registrant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: 'approved' | 'pending' | 'denied';
  create_time: string;
  join_url: string;
  extra: Record<string, unknown>;
}

export interface FakeParticipant {
  id: string;
  user_id: string;
  name: string;
  user_email: string;
  /** seconds */
  duration: number;
  join_time: string;
  leave_time: string;
}

export interface FakeParticipantInput {
  name: string;
  user_email?: string;
  /** seconds in the meeting for this join session */
  duration: number;
  join_time?: string;
  leave_time?: string;
}

export interface FakePanelist {
  id: string;
  name: string;
  email: string;
  join_url: string;
}

export interface FakeToken {
  accessToken: string;
  refreshToken?: string;
  kind: 'user' | 'server-to-server';
  grant: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  /** Set by expireAllTokens(). */
  forcedExpired: boolean;
}

export interface FakeRefreshToken {
  token: string;
  scopes: string[];
  used: boolean;
  issuedAt: number;
}

export interface FakeAuthCode {
  code: string;
  redirectUri: string;
  used: boolean;
}

export interface RequestLogEntry {
  seq: number;
  time: number;
  method: string;
  /** For the REST API: path relative to /v2 (e.g. `/users/me/meetings`). For OAuth: `/oauth/token`. */
  path: string;
  query: Record<string, string>;
  area: 'oauth' | 'api' | 'other';
  headers: Record<string, string>;
  /** Parsed JSON body (REST) or form fields (OAuth); undefined if none. */
  body: unknown;
  /** 0 = connection dropped / not yet answered. */
  status: number;
  faulted: boolean;
  rateLimited: boolean;
}

export interface FaultRule {
  /** Glob (`*` matches anything incl. `/`) against the path without `/v2` and query, or a RegExp. OAuth paths are `/oauth/token`, `/oauth/authorize`. */
  match: string | RegExp;
  method?: string;
  /** How many matching requests to affect. Default 1. */
  times?: number | 'forever';
  /** Status to answer with. Omit (with dropConnection unset) for a delay-only fault that then proceeds normally. */
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  dropConnection?: boolean;
}

export interface InstalledFault extends FaultRule {
  id: number;
  /** How many requests this rule has affected so far. */
  hits: number;
}

export interface FakeZoomState {
  meetings: Map<number, FakeMeeting>;
  webinars: Map<number, FakeMeeting>;
  /** keyed by meeting/webinar id */
  registrants: Map<number, FakeRegistrant[]>;
  pastParticipants: Map<number, FakeParticipant[]>;
  panelists: Map<number, FakePanelist[]>;
  /** Every access token ever issued, in order. */
  tokens: FakeToken[];
  refreshTokens: Map<string, FakeRefreshToken>;
  authCodes: Map<string, FakeAuthCode>;
  requestLog: RequestLogEntry[];
  faults: InstalledFault[];
}

export interface SeedMeetingInput {
  kind?: FakeEventKind;
  topic?: string;
  start_time?: string;
  duration?: number;
  agenda?: string;
  /** Default 2 (no registration) like real Zoom. Honoured even for an unlicensed host (it is a seed). */
  approval_type?: number;
  registration_type?: number;
  registrants_restrict_number?: number;
}

export interface SendWebhookOptions {
  /** Added to "now" for x-zm-request-timestamp (and the signature). e.g. -600 = stale. */
  timestampOffsetSec?: number;
  /** Sends a well-formed but wrong signature. */
  badSignature?: boolean;
  /** Sends neither x-zm-signature nor x-zm-request-timestamp. */
  omitHeaders?: boolean;
  /** Sign + send this exact string instead of JSON.stringify(event) (e.g. invalid JSON). */
  rawBody?: string;
  /** Default `/api/webhooks/zoom`. */
  path?: string;
}

export interface FakeZoom {
  /** Base for ZOOM_OAUTH_BASE_URL. */
  oauthUrl: string;
  /** Base for ZOOM_API_BASE_URL (includes /v2). */
  apiUrl: string;
  /** http://127.0.0.1:<port> */
  origin: string;
  port: number;
  state: FakeZoomState;
  config: FakeZoomConfig;
  setFault(rule: FaultRule): InstalledFault;
  clearFaults(): void;
  /** Clears all state, faults, clock offset and restores config to the start options. */
  reset(): void;
  stop(): Promise<void>;
  /** Every access token becomes invalid (next API call -> 401 code 124). Refresh tokens stay valid. */
  expireAllTokens(): void;
  /** Moves the fake's clock forward (token expiry, "upcoming" filtering). */
  advanceTime(ms: number): void;
  seedMeeting(input?: SeedMeetingInput): FakeMeeting;
  seedRegistrant(eventId: number, r: { email: string; first_name: string; last_name?: string; status?: FakeRegistrant['status'] }): FakeRegistrant;
  seedPanelists(webinarId: number, panelists: Array<{ name: string; email: string }>): FakePanelist[];
  /** Appends join sessions (one row each). Pass `{ replace: true }` to overwrite. */
  seedPastParticipants(meetingId: number | string, participants: FakeParticipantInput[], opts?: { replace?: boolean }): FakeParticipant[];
  /** Marks the meeting ended (participants become fetchable) and returns the `meeting.ended` / `webinar.ended` webhook event for it. */
  endMeeting(id: number | string): Record<string, unknown>;
  meetingEndedEvent(id: number | string): Record<string, unknown>;
  /** `meeting.registration_created` / `webinar.registration_created` event for a registrant (by registrant_id or email). */
  registrationCreatedEvent(eventId: number | string, registrant: string): Record<string, unknown>;
  sendWebhook(appUrl: string, secret: string, event: object, opts?: SendWebhookOptions): Promise<Response>;
  sendCrc(appUrl: string, secret: string, opts?: SendWebhookOptions): Promise<{ response: Response; plainToken: string; expectedEncryptedToken: string }>;
}

// ───────────────────────────── scopes ─────────────────────────────

export const FAKE_ZOOM_ALL_SCOPES: string[] = [
  'user:read:user',
  'meeting:read:list_meetings',
  'meeting:read:meeting',
  'meeting:write:meeting',
  'meeting:update:meeting',
  'meeting:delete:meeting',
  'meeting:write:registrant',
  'meeting:read:list_registrants',
  'meeting:update:registrant_status',
  'meeting:read:list_past_participants',
  'webinar:read:list_webinars',
  'webinar:read:webinar',
  'webinar:write:webinar',
  'webinar:update:webinar',
  'webinar:delete:webinar',
  'webinar:write:registrant',
  'webinar:read:list_registrants',
  'webinar:update:registrant_status',
  'webinar:read:list_panelists',
  'webinar:read:list_past_participants',
];

// ───────────────────────────── small helpers ─────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const rand = (bytes: number) => randomBytes(bytes).toString('base64url');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });
const err = (status: number, code: number, message: string, extra?: Obj): Reply => json(status, { code, message, ...(extra ?? {}) });
const validationFail = (errors: Array<{ field: string; message: string }>): Reply =>
  json(400, { code: 300, message: 'Validation Failed.', errors });

const INVALID_TOKEN = (): Reply => err(401, 124, 'Invalid access token.');

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function toZoomIso(input: string): string | null {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
  const ms = Date.parse(hasZone ? input : `${input}Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseEventId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ───────────────────────────── webhook sender (standalone) ─────────────────────────────

function zoomSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

/** POSTs `event` to `<appUrl>/api/webhooks/zoom` signed exactly like Zoom does. */
export async function sendZoomWebhook(appUrl: string, secret: string, event: object, opts: SendWebhookOptions = {}): Promise<Response> {
  const rawBody = opts.rawBody ?? JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000) + (opts.timestampOffsetSec ?? 0));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.omitHeaders) {
    let sig = zoomSignature(secret, timestamp, rawBody);
    if (opts.badSignature) sig = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    headers['x-zm-signature'] = sig;
    headers['x-zm-request-timestamp'] = timestamp;
  }
  return fetch(`${appUrl.replace(/\/+$/, '')}${opts.path ?? '/api/webhooks/zoom'}`, {
    method: 'POST',
    headers,
    body: rawBody,
    cache: 'no-store',
  });
}

/** Sends an `endpoint.url_validation` challenge; also returns the answer a correct receiver must give. */
export async function sendZoomCrc(appUrl: string, secret: string, opts: SendWebhookOptions = {}) {
  const plainToken = rand(16);
  const response = await sendZoomWebhook(appUrl, secret, { event: 'endpoint.url_validation', payload: { plainToken }, event_ts: Date.now() }, opts);
  const expectedEncryptedToken = createHmac('sha256', secret).update(plainToken).digest('hex');
  return { response, plainToken, expectedEncryptedToken };
}

// ───────────────────────────── the server ─────────────────────────────

const HOST_USER_ID = 'KDcuGIm1QgePTO8WbOqwIQ';

interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  bodyInvalid: boolean;
  token: FakeToken;
}

interface Route {
  method: string;
  pattern: RegExp;
  scope?: string;
  /** Webinar route: needs the add-on. */
  webinar?: boolean;
  handler: (c: Ctx, m: RegExpMatchArray) => Reply;
}

export async function startFakeZoom(opts: FakeZoomOptions = {}): Promise<FakeZoom> {
  const initial: FakeZoomConfig = {
    clientId: opts.clientId ?? 'fake-client-id',
    clientSecret: opts.clientSecret ?? 'fake-client-secret',
    accountId: opts.accountId ?? 'fake-account-id',
    hostEmail: opts.hostEmail ?? 'host@fake-zoom.test',
    hostLicensed: opts.hostLicensed ?? true,
    webinarAddOn: opts.webinarAddOn ?? false,
    scopes: [...(opts.scopes ?? FAKE_ZOOM_ALL_SCOPES)],
    maxRegistrants: opts.maxRegistrants ?? 4999,
    tokenTtlSec: opts.tokenTtlSec ?? 3600,
    maxPageSize: opts.maxPageSize ?? 300,
    rateLimit: opts.rateLimit ?? null,
    strictAuthCodes: opts.strictAuthCodes ?? false,
  };
  const config: FakeZoomConfig = { ...initial, scopes: [...initial.scopes], rateLimit: initial.rateLimit ? { ...initial.rateLimit } : null };

  const state: FakeZoomState = {
    meetings: new Map(),
    webinars: new Map(),
    registrants: new Map(),
    pastParticipants: new Map(),
    panelists: new Map(),
    tokens: [],
    refreshTokens: new Map(),
    authCodes: new Map(),
    requestLog: [],
    faults: [],
  };
  const accessIndex = new Map<string, FakeToken>();

  let origin = '';
  let clockOffsetMs = 0;
  let nextEventNo = 1;
  let nextSeq = 1;
  let nextFaultId = 1;
  let nextCodeNo = 1;
  let rlWindowStart = 0;
  let rlCount = 0;
  const now = () => Date.now() + clockOffsetMs;

  // ── events ──
  const findEvent = (id: number): FakeMeeting | undefined => state.meetings.get(id) ?? state.webinars.get(id);
  const registrationUrl = (m: FakeMeeting): string | undefined =>
    m.settings.approval_type === 0 || m.settings.approval_type === 1 ? `${origin}/${m.kind}/register/${m.registrationToken}` : undefined;

  function defaultSettings(): FakeMeeting['settings'] {
    return {
      host_video: false,
      participant_video: false,
      cn_meeting: false,
      in_meeting: false,
      join_before_host: false,
      jbh_time: 0,
      mute_upon_entry: false,
      watermark: false,
      use_pmi: false,
      approval_type: 2,
      registration_type: 1,
      audio: 'both',
      auto_recording: 'none',
      enforce_login: false,
      waiting_room: true,
      registrants_email_notification: true,
      registrants_confirmation_email: true,
      meeting_authentication: false,
      alternative_hosts: '',
      contact_name: 'Fake Host',
      contact_email: config.hostEmail,
      registrants_restrict_number: 0,
    };
  }

  function createEvent(kind: FakeEventKind, input: SeedMeetingInput & { timezone?: string }): FakeMeeting {
    const id = 85_000_000_000 + nextEventNo++;
    const password = randomBytes(4).toString('hex').slice(0, 6);
    const m: FakeMeeting = {
      id,
      uuid: `${rand(16)}==`,
      kind,
      type: kind === 'webinar' ? 5 : 2,
      host_id: HOST_USER_ID,
      host_email: config.hostEmail,
      topic: input.topic ?? (kind === 'webinar' ? 'My Webinar' : 'My Meeting'),
      ...(input.start_time ? { start_time: input.start_time } : {}),
      duration: input.duration ?? 60,
      timezone: input.timezone ?? 'UTC',
      agenda: input.agenda ?? '',
      created_at: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      status: 'waiting',
      join_url: `${origin}/j/${id}?pwd=${rand(24)}`,
      start_url: `${origin}/s/${id}?zak=${rand(24)}`,
      password,
      registrationToken: rand(18),
      settings: defaultSettings(),
    };
    if (input.approval_type !== undefined) m.settings.approval_type = input.approval_type;
    if (input.registration_type !== undefined) m.settings.registration_type = input.registration_type;
    if (input.registrants_restrict_number !== undefined) m.settings.registrants_restrict_number = input.registrants_restrict_number;
    (kind === 'webinar' ? state.webinars : state.meetings).set(id, m);
    state.registrants.set(id, []);
    return m;
  }

  function serializeEvent(m: FakeMeeting, full: boolean): Obj {
    const base: Obj = {
      uuid: m.uuid,
      id: m.id,
      host_id: m.host_id,
      topic: m.topic,
      type: m.type,
      ...(m.start_time ? { start_time: m.start_time } : {}),
      duration: m.duration,
      timezone: m.timezone,
      agenda: m.agenda,
      created_at: m.created_at,
      join_url: m.join_url,
    };
    if (!full) return base;
    const reg = registrationUrl(m);
    return {
      ...base,
      host_email: m.host_email,
      status: m.status,
      start_url: m.start_url,
      password: m.password,
      h323_password: m.password,
      pstn_password: m.password,
      encrypted_password: m.join_url.split('pwd=')[1] ?? '',
      pre_schedule: false,
      ...(reg ? { registration_url: reg } : {}),
      settings: { ...m.settings },
    };
  }

  function serializeRegistrant(r: FakeRegistrant): Obj {
    return {
      id: r.registrant_id,
      email: r.email,
      first_name: r.first_name,
      last_name: r.last_name,
      address: '',
      city: '',
      country: '',
      zip: '',
      state: '',
      phone: '',
      industry: '',
      org: '',
      job_title: '',
      purchasing_time_frame: '',
      role_in_purchase_process: '',
      no_of_employees: '',
      comments: '',
      custom_questions: [],
      status: r.status,
      create_time: r.create_time,
      join_url: r.join_url,
      ...r.extra,
    };
  }

  function newRegistrant(m: FakeMeeting, r: { email: string; first_name: string; last_name?: string; status?: FakeRegistrant['status'] }): FakeRegistrant {
    const registrantId = rand(16);
    const status = r.status ?? (m.settings.approval_type === 1 ? 'pending' : 'approved');
    const reg: FakeRegistrant = {
      registrant_id: registrantId,
      email: r.email,
      first_name: r.first_name,
      last_name: r.last_name ?? '',
      status,
      create_time: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      join_url: `${origin}/w/${m.id}?tk=${rand(24)}&pwd=${m.join_url.split('pwd=')[1] ?? ''}`,
      extra: {},
    };
    const list = state.registrants.get(m.id) ?? [];
    list.push(reg);
    state.registrants.set(m.id, list);
    return reg;
  }

  // ── pagination ──
  function paginate<T>(items: T[], q: URLSearchParams): { page: T[]; pageSize: number; next: string } | Reply {
    let pageSize = 30;
    const rawSize = q.get('page_size');
    if (rawSize !== null) {
      const n = Number(rawSize);
      if (!Number.isInteger(n) || n < 1) return validationFail([{ field: 'page_size', message: 'Invalid field: page_size.' }]);
      pageSize = n;
    }
    pageSize = Math.min(pageSize, config.maxPageSize);
    let offset = 0;
    const tok = q.get('next_page_token');
    if (tok) {
      const m = /^fz1\.(\d+)\.[A-Za-z0-9_-]+$/.exec(tok);
      if (!m || Number(m[1]) > items.length) return err(400, 300, 'The next page token is invalid or expired.');
      offset = Number(m[1]);
    }
    const page = items.slice(offset, offset + pageSize);
    const end = offset + page.length;
    return { page, pageSize, next: end < items.length ? `fz1.${end}.${rand(9)}` : '' };
  }
  const isReply = (v: unknown): v is Reply => isObj(v) && typeof v.status === 'number';

  // ── user resolution ──
  function resolveUser(c: Ctx, seg: string): Reply | null {
    if (seg === 'me') {
      if (c.token.kind === 'server-to-server') {
        // Real Zoom: a Server-to-Server token is not bound to a user, so `me` is meaningless.
        return err(400, 1010, 'User does not belong to this account: me.');
      }
      return null;
    }
    if (seg === HOST_USER_ID || seg.toLowerCase() === config.hostEmail.toLowerCase()) return null;
    return err(404, 1001, `User does not exist: ${seg}.`);
  }

  // ── event body validation / settings ──
  function validateEventBody(body: Obj): Array<{ field: string; message: string }> {
    const errors: Array<{ field: string; message: string }> = [];
    const bad = (field: string) => errors.push({ field, message: `Invalid field: ${field}.` });
    if (body.topic !== undefined && (typeof body.topic !== 'string' || body.topic.length > 200)) bad('topic');
    if (body.agenda !== undefined && (typeof body.agenda !== 'string' || body.agenda.length > 2000)) bad('agenda');
    if (body.duration !== undefined && (!Number.isInteger(body.duration) || (body.duration as number) < 0)) bad('duration');
    if (body.start_time !== undefined && (typeof body.start_time !== 'string' || toZoomIso(body.start_time) === null)) bad('start_time');
    if (body.timezone !== undefined && typeof body.timezone !== 'string') bad('timezone');
    if (body.settings !== undefined) {
      if (!isObj(body.settings)) bad('settings');
      else {
        const s = body.settings;
        if (s.approval_type !== undefined && ![0, 1, 2].includes(s.approval_type as number)) bad('settings.approval_type');
        if (s.registration_type !== undefined && ![1, 2, 3].includes(s.registration_type as number)) bad('settings.registration_type');
      }
    }
    return errors;
  }

  function applyEventBody(m: FakeMeeting, body: Obj): void {
    if (typeof body.topic === 'string') m.topic = body.topic;
    if (typeof body.agenda === 'string') m.agenda = body.agenda;
    if (typeof body.duration === 'number') m.duration = body.duration;
    if (typeof body.timezone === 'string') m.timezone = body.timezone;
    if (typeof body.start_time === 'string') m.start_time = toZoomIso(body.start_time) ?? m.start_time;
    if (isObj(body.settings)) {
      for (const [k, v] of Object.entries(body.settings)) {
        // Real Zoom silently drops registration settings for an unlicensed (Basic) host.
        if ((k === 'approval_type' || k === 'registration_type') && !config.hostLicensed) continue;
        m.settings[k] = v;
      }
    }
  }

  // ── routes ──
  const routes: Route[] = [];
  const route = (method: string, pattern: RegExp, handler: Route['handler'], extra: Partial<Route> = {}) => routes.push({ method, pattern, handler, ...extra });

  route('GET', /^\/users\/([^/]+)$/, (c, m) => {
    const bad = resolveUser(c, decodeURIComponent(m[1]));
    if (bad) return bad;
    return json(200, {
      id: HOST_USER_ID,
      first_name: 'Fake',
      last_name: 'Host',
      display_name: 'Fake Host',
      email: config.hostEmail,
      type: config.hostLicensed ? 2 : 1,
      status: 'active',
      role_name: 'Owner',
      pmi: 5551234567,
      timezone: 'UTC',
      verified: 1,
      account_id: config.accountId,
      created_at: '2020-01-01T00:00:00Z',
    });
  }, { scope: 'user:read:user' });

  for (const kind of ['meeting', 'webinar'] as const) {
    const coll = kind === 'meeting' ? 'meetings' : 'webinars';
    const sc = (a: string) => `${kind}:${a}`;
    const label = kind === 'meeting' ? 'Meeting' : 'Webinar';
    const webinar = kind === 'webinar';
    const get = (id: number): FakeMeeting | undefined => (kind === 'meeting' ? state.meetings : state.webinars).get(id);
    const notFound = (id: string) => err(404, 3001, `${label} does not exist: ${id}.`);

    // list
    route('GET', new RegExp(`^/users/([^/]+)/${coll}$`), (c, m) => {
      const bad = resolveUser(c, decodeURIComponent(m[1]));
      if (bad) return bad;
      const type = c.query.get('type') ?? (webinar ? 'upcoming' : 'scheduled');
      const valid = webinar ? ['upcoming', 'scheduled'] : ['scheduled', 'live', 'upcoming', 'upcoming_meetings', 'previous_meetings'];
      if (!valid.includes(type)) return validationFail([{ field: 'type', message: 'Invalid field: type.' }]);
      const all = [...(kind === 'meeting' ? state.meetings : state.webinars).values()].filter((e) => {
        if (type === 'previous_meetings') return e.status === 'ended';
        if (type === 'live') return e.status === 'started';
        if (e.status === 'ended') return false;
        if (type === 'scheduled') return true;
        // upcoming: not yet over
        return !e.start_time || Date.parse(e.start_time) + e.duration * 60_000 >= now();
      });
      const p = paginate(all, c.query);
      if (isReply(p)) return p;
      return json(200, {
        page_size: p.pageSize,
        total_records: all.length,
        next_page_token: p.next,
        [coll]: p.page.map((e) => serializeEvent(e, false)),
      });
    }, { scope: sc(kind === 'meeting' ? 'read:list_meetings' : 'read:list_webinars'), webinar });

    // create
    route('POST', new RegExp(`^/users/([^/]+)/${coll}$`), (c, m) => {
      const bad = resolveUser(c, decodeURIComponent(m[1]));
      if (bad) return bad;
      if (!isObj(c.body)) return err(400, 300, 'Request Body should be a valid JSON object.');
      const errors = validateEventBody(c.body);
      if (errors.length) return validationFail(errors);
      const ev = createEvent(kind, {});
      applyEventBody(ev, c.body);
      return json(201, serializeEvent(ev, true));
    }, { scope: sc('write:' + kind), webinar });

    // get / patch / delete
    route('GET', new RegExp(`^/${coll}/([^/]+)$`), (_c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      const ev = get(id);
      return ev ? json(200, serializeEvent(ev, true)) : notFound(m[1]);
    }, { scope: sc('read:' + kind), webinar });

    route('PATCH', new RegExp(`^/${coll}/([^/]+)$`), (c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      const ev = get(id);
      if (!ev) return notFound(m[1]);
      if (!isObj(c.body)) return err(400, 300, 'Request Body should be a valid JSON object.');
      const errors = validateEventBody(c.body);
      if (errors.length) return validationFail(errors);
      applyEventBody(ev, c.body);
      return { status: 204 };
    }, { scope: sc('update:' + kind), webinar });

    route('DELETE', new RegExp(`^/${coll}/([^/]+)$`), (_c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      if (!get(id)) return notFound(m[1]);
      (kind === 'meeting' ? state.meetings : state.webinars).delete(id);
      state.registrants.delete(id);
      return { status: 204 };
    }, { scope: sc('delete:' + kind), webinar });

    // registrants
    route('POST', new RegExp(`^/${coll}/([^/]+)/registrants$`), (c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      const ev = get(id);
      if (!ev) return notFound(m[1]);
      if (ev.status === 'ended') return err(400, 3001, `${label} ${id} is not found or has expired.`);
      if (ev.settings.approval_type === 2) {
        return err(400, 3027, `Registration has not been enabled for this ${kind}: ${id}.`);
      }
      if (!config.hostLicensed) return err(400, 200, 'Only available for Licensed users.');
      if (!isObj(c.body)) return err(400, 300, 'Request Body should be a valid JSON object.');
      const errors: Array<{ field: string; message: string }> = [];
      const b = c.body;
      if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) errors.push({ field: 'email', message: 'Invalid field: email.' });
      if (typeof b.first_name !== 'string' || !b.first_name.trim() || b.first_name.length > 64) errors.push({ field: 'first_name', message: 'Invalid field: first_name.' });
      if (b.last_name !== undefined && (typeof b.last_name !== 'string' || b.last_name.length > 64)) errors.push({ field: 'last_name', message: 'Invalid field: last_name.' });
      if (errors.length) return validationFail(errors);
      const email = (b.email as string).trim();

      const list = state.registrants.get(id) ?? [];
      // Same email again -> Zoom returns the EXISTING registrant (same registrant_id / join_url).
      const existing = list.find((r) => r.email.toLowerCase() === email.toLowerCase());
      const respond = (r: FakeRegistrant): Reply =>
        json(201, {
          id: ev.id,
          registrant_id: r.registrant_id,
          topic: ev.topic,
          ...(ev.start_time ? { start_time: ev.start_time } : {}),
          // pending (manual approval) registrants get their join link only once approved
          ...(r.status === 'approved' ? { join_url: r.join_url } : {}),
        });
      if (existing) return respond(existing);

      const restrict = typeof ev.settings.registrants_restrict_number === 'number' && ev.settings.registrants_restrict_number > 0 ? ev.settings.registrants_restrict_number : Infinity;
      const cap = Math.min(config.maxRegistrants, restrict);
      if (list.filter((r) => r.status !== 'denied').length >= cap) {
        return err(400, 3001, `${label} ${id} registrant limit reached (${cap}).`);
      }
      return respond(newRegistrant(ev, { email, first_name: (b.first_name as string).trim(), last_name: typeof b.last_name === 'string' ? b.last_name : '' }));
    }, { scope: sc('write:registrant'), webinar });

    route('GET', new RegExp(`^/${coll}/([^/]+)/registrants$`), (c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      const ev = get(id);
      if (!ev) return notFound(m[1]);
      const status = c.query.get('status') ?? 'pending';
      if (!['pending', 'approved', 'denied'].includes(status)) return validationFail([{ field: 'status', message: 'Invalid field: status.' }]);
      const all = (state.registrants.get(id) ?? []).filter((r) => r.status === status);
      const p = paginate(all, c.query);
      if (isReply(p)) return p;
      return json(200, {
        page_count: Math.max(1, Math.ceil(all.length / p.pageSize)),
        page_number: 1,
        page_size: p.pageSize,
        total_records: all.length,
        next_page_token: p.next,
        registrants: p.page.map(serializeRegistrant),
      });
    }, { scope: sc('read:list_registrants'), webinar });

    route('PUT', new RegExp(`^/${coll}/([^/]+)/registrants/status$`), (c, m) => {
      const id = parseEventId(m[1]);
      if (id === null) return err(400, 300, `Invalid field: ${kind}Id.`);
      if (!get(id)) return notFound(m[1]);
      if (!isObj(c.body) || !['approve', 'cancel', 'deny'].includes(String(c.body.action)) || !Array.isArray(c.body.registrants)) {
        return validationFail([{ field: 'action', message: 'Invalid field: action.' }]);
      }
      const next: FakeRegistrant['status'] = c.body.action === 'approve' ? 'approved' : 'denied';
      for (const entry of c.body.registrants) {
        if (!isObj(entry)) continue;
        const r = (state.registrants.get(id) ?? []).find((x) => x.registrant_id === entry.id || (typeof entry.email === 'string' && x.email.toLowerCase() === entry.email.toLowerCase()));
        if (r) r.status = next;
      }
      return { status: 204 };
    }, { scope: sc('update:registrant_status'), webinar });
  }

  route('GET', /^\/webinars\/([^/]+)\/panelists$/, (_c, m) => {
    const id = parseEventId(m[1]);
    if (id === null || !state.webinars.has(id)) return err(404, 3001, `Webinar does not exist: ${m[1]}.`);
    const list = state.panelists.get(id) ?? [];
    return json(200, { total_records: list.length, panelists: list });
  }, { scope: 'webinar:read:list_panelists', webinar: true });

  // Real Zoom has no tracking-source API (docs/ZOOM_AND_LSQ_SETUP.md): POST is a 404, GET is empty.
  route('POST', /^\/webinars\/([^/]+)\/tracking_sources$/, () => err(404, 404, 'Not Found'));
  route('GET', /^\/webinars\/([^/]+)\/tracking_sources$/, () => json(200, { tracking_sources: [] }));

  route('GET', /^\/past_meetings\/([^/]+)\/participants$/, (c, m) => {
    let raw = decodeURIComponent(m[1]);
    if (raw.includes('%')) raw = decodeURIComponent(raw); // uuids with "/" are double-encoded
    const asId = parseEventId(raw);
    const ev = asId !== null ? findEvent(asId) : [...state.meetings.values(), ...state.webinars.values()].find((e) => e.uuid === raw);
    if (!ev) return err(404, 3001, `Meeting does not exist: ${raw}.`);
    if (ev.status !== 'ended') return err(404, 3001, 'Meeting ID is invalid or not end.');
    const all = state.pastParticipants.get(ev.id) ?? [];
    const p = paginate(all, c.query);
    if (isReply(p)) return p;
    return json(200, {
      page_count: Math.max(1, Math.ceil(all.length / p.pageSize)),
      page_size: p.pageSize,
      total_records: all.length,
      next_page_token: p.next,
      participants: p.page.map((x) => ({ ...x, registrant_id: '', failover: false, status: 'in_meeting' })),
    });
  }, { scope: 'meeting:read:list_past_participants' });

  // ── OAuth ──
  function tokenResponse(token: FakeToken): Reply {
    return json(
      200,
      {
        access_token: token.accessToken,
        token_type: 'bearer',
        ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
        expires_in: Math.max(0, Math.round((token.expiresAt - now()) / 1000)),
        scope: token.scopes.join(' '),
        api_url: 'https://api.zoom.us',
      },
      { 'cache-control': 'no-store', pragma: 'no-cache' }
    );
  }

  function issueToken(kind: FakeToken['kind'], grant: string, scopes: string[]): FakeToken {
    const refreshToken = kind === 'user' ? `fakert_${rand(24)}` : undefined;
    const token: FakeToken = {
      accessToken: `fakeat_${rand(24)}`,
      ...(refreshToken ? { refreshToken } : {}),
      kind,
      grant,
      scopes: [...scopes],
      issuedAt: now(),
      expiresAt: now() + config.tokenTtlSec * 1000,
      forcedExpired: false,
    };
    state.tokens.push(token);
    accessIndex.set(token.accessToken, token);
    if (refreshToken) state.refreshTokens.set(refreshToken, { token: refreshToken, scopes: [...scopes], used: false, issuedAt: now() });
    return token;
  }

  function oauthToken(headers: IncomingMessage['headers'], params: URLSearchParams): Reply {
    const basic = /^Basic\s+(.+)$/i.exec(String(headers.authorization ?? ''));
    const creds = basic ? Buffer.from(basic[1], 'base64').toString('utf8') : '';
    if (creds !== `${config.clientId}:${config.clientSecret}`) {
      return json(401, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
    }
    const grant = params.get('grant_type');
    if (!grant) return json(400, { reason: 'Missing grant type', error: 'invalid_request' });

    if (grant === 'authorization_code') {
      const code = params.get('code');
      if (!code) return json(400, { reason: 'Missing authorization code', error: 'invalid_request' });
      if (config.strictAuthCodes) {
        const known = state.authCodes.get(code);
        if (!known || known.used) return json(400, { reason: 'Invalid authorization code', error: 'invalid_grant' });
        if (params.get('redirect_uri') !== known.redirectUri) return json(400, { reason: 'Redirect URI mismatch.', error: 'invalid_grant' });
        known.used = true;
      }
      return tokenResponse(issueToken('user', grant, config.scopes));
    }
    if (grant === 'refresh_token') {
      const rt = params.get('refresh_token');
      const rec = rt ? state.refreshTokens.get(rt) : undefined;
      if (!rec || rec.used) return json(400, { reason: 'Invalid Token!', error: 'invalid_request' });
      rec.used = true; // ROTATION: the presented refresh token is dead from now on
      return tokenResponse(issueToken('user', grant, rec.scopes));
    }
    if (grant === 'account_credentials') {
      const acct = params.get('account_id');
      if (!acct) return json(400, { reason: 'Missing account_id', error: 'invalid_request' });
      if (acct !== config.accountId) return json(400, { reason: 'Invalid account id', error: 'invalid_request' });
      return tokenResponse(issueToken('server-to-server', grant, config.scopes));
    }
    return json(400, { reason: 'Invalid grant type', error: 'unsupported_grant_type' });
  }

  function oauthAuthorize(params: URLSearchParams): Reply {
    if (params.get('client_id') !== config.clientId) return json(400, { reason: 'Invalid client_id', error: 'invalid_client' });
    if (params.get('response_type') !== 'code') return json(400, { reason: 'Invalid response_type', error: 'unsupported_response_type' });
    const redirectUri = params.get('redirect_uri');
    if (!redirectUri) return json(400, { reason: 'Missing redirect_uri', error: 'invalid_request' });
    let target: URL;
    try {
      target = new URL(redirectUri);
    } catch {
      return json(400, { reason: 'Invalid redirect_uri', error: 'invalid_request' });
    }
    const code = `fakecode_${nextCodeNo++}_${rand(9)}`;
    state.authCodes.set(code, { code, redirectUri, used: false });
    target.searchParams.set('code', code);
    const st = params.get('state');
    if (st !== null) target.searchParams.set('state', st);
    return { status: 302, headers: { location: target.toString() } };
  }

  // ── request pipeline ──
  function authenticate(headers: IncomingMessage['headers']): FakeToken | Reply {
    const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
    const token = m ? accessIndex.get(m[1].trim()) : undefined;
    if (!token || token.forcedExpired || now() >= token.expiresAt) return INVALID_TOKEN();
    return token;
  }

  function hasScope(token: FakeToken, required: string): boolean {
    return token.scopes.includes(required) || token.scopes.includes(`${required}:admin`);
  }

  function takeFault(method: string, path: string): InstalledFault | undefined {
    for (const f of state.faults) {
      if (f.method && f.method.toUpperCase() !== method) continue;
      const hit = typeof f.match === 'string' ? globToRegExp(f.match).test(path) : f.match.test(path);
      if (!hit) continue;
      f.hits++;
      if (f.times !== 'forever' && f.hits >= (f.times ?? 1)) state.faults.splice(state.faults.indexOf(f), 1);
      return f;
    }
    return undefined;
  }

  function writeReply(res: ServerResponse, reply: Reply): void {
    const headers: Record<string, string> = { ...(reply.headers ?? {}) };
    let payload = '';
    if (reply.body !== undefined) {
      if (typeof reply.body === 'string') payload = reply.body;
      else payload = JSON.stringify(reply.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json;charset=UTF-8';
    }
    res.writeHead(reply.status, headers);
    res.end(reply.status === 204 || reply.status === 302 ? undefined : payload);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://fake');
    const raw = await readBody(req);
    const isApi = url.pathname === '/v2' || url.pathname.startsWith('/v2/');
    const area: RequestLogEntry['area'] = url.pathname.startsWith('/oauth/') ? 'oauth' : isApi ? 'api' : 'other';
    const path = isApi ? url.pathname.slice(3) || '/' : url.pathname;

    let parsedBody: unknown;
    let bodyInvalid = false;
    let formParams = new URLSearchParams();
    if (raw) {
      if (area === 'oauth') {
        formParams = new URLSearchParams(raw);
        parsedBody = Object.fromEntries(formParams.entries());
      } else {
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          bodyInvalid = true;
          parsedBody = raw;
        }
      }
    }

    const entry: RequestLogEntry = {
      seq: nextSeq++,
      time: Date.now(),
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      area,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
      body: parsedBody,
      status: 0,
      faulted: false,
      rateLimited: false,
    };
    state.requestLog.push(entry);
    const finish = (reply: Reply) => {
      entry.status = reply.status;
      writeReply(res, reply);
    };

    // 1. fault injection (applies before auth/rate limiting, like a flaky network edge)
    if (area !== 'other') {
      const fault = takeFault(method, path);
      if (fault) {
        entry.faulted = true;
        if (fault.delayMs) await sleep(fault.delayMs);
        if (fault.dropConnection) {
          req.socket.destroy();
          return;
        }
        if (fault.status !== undefined) {
          finish({ status: fault.status, body: fault.body ?? { code: fault.status, message: 'Injected fault' }, headers: fault.headers });
          return;
        }
      }
    }

    // 2. OAuth
    if (area === 'oauth') {
      const params = new URLSearchParams(url.searchParams);
      for (const [k, v] of formParams) params.set(k, v);
      if (path === '/oauth/token' && method === 'POST') return finish(oauthToken(req.headers, params));
      if (path === '/oauth/authorize' && method === 'GET') return finish(oauthAuthorize(params));
      return finish(json(404, { reason: 'Not Found', error: 'not_found' }));
    }

    // 3. cosmetic pages (join / registration links) so URLs handed out by the fake resolve
    if (area === 'other') {
      if (/^\/(j|w|s|meeting\/register|webinar\/register)\//.test(path)) {
        return finish({ status: 200, body: `<html><body>Fake Zoom page ${path}</body></html>`, headers: { 'content-type': 'text/html' } });
      }
      return finish(err(404, 404, 'Not Found'));
    }

    // 4. REST rate limit
    if (config.rateLimit) {
      const t = Date.now();
      if (t - rlWindowStart >= 1000) {
        rlWindowStart = t;
        rlCount = 0;
      }
      rlCount++;
      if (rlCount > config.rateLimit.perSecond) {
        entry.rateLimited = true;
        const retryAfter = Math.max(1, Math.ceil((rlWindowStart + 1000 - t) / 1000));
        return finish({
          status: 429,
          body: { code: 429, message: 'You have reached the maximum per-second rate limit for this API.' },
          headers: { 'retry-after': String(retryAfter) },
        });
      }
    }

    // 5. auth
    const auth = authenticate(req.headers);
    if (isReply(auth)) return finish(auth);
    const token = auth;

    // 6. route
    const candidates = routes.filter((r) => r.method === method);
    for (const r of candidates) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      if (r.scope && !hasScope(token, r.scope)) {
        const shown = token.kind === 'server-to-server' ? `${r.scope}:admin` : r.scope;
        return finish(err(400, 4711, `Invalid access token, does not contain scopes:[${shown}].`));
      }
      if (r.webinar && !config.webinarAddOn) return finish(err(400, 200, 'Webinar plan is missing'));
      if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && bodyInvalid) {
        return finish(err(400, 300, 'Request Body should be a valid JSON object.'));
      }
      const ctx: Ctx = { method, path, query: url.searchParams, body: raw ? parsedBody : undefined, bodyInvalid, token };
      return finish(r.handler(ctx, m));
    }
    return finish(err(404, 404, `Not Found: ${method} ${path}`));
  }

  // ── listen ──
  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) writeReply(res, json(500, { code: 500, message: `fake zoom internal error: ${e instanceof Error ? e.message : String(e)}` }));
      else res.end();
    });
  });
  const sockets = new Set<Socket>();
  server.on('connection', (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  // ── helpers exposed on the handle ──
  function resolveEvent(id: number | string): FakeMeeting {
    const n = typeof id === 'number' ? id : Number(id);
    const ev = findEvent(n);
    if (!ev) throw new Error(`fake zoom: no meeting/webinar ${id}`);
    return ev;
  }

  function endedEvent(ev: FakeMeeting): Record<string, unknown> {
    return {
      event: `${ev.kind}.ended`,
      event_ts: Date.now(),
      payload: {
        account_id: config.accountId,
        object: {
          id: String(ev.id),
          uuid: ev.uuid,
          host_id: ev.host_id,
          topic: ev.topic,
          type: ev.type,
          ...(ev.start_time ? { start_time: ev.start_time } : {}),
          timezone: ev.timezone,
          duration: ev.duration,
          end_time: ev.end_time ?? new Date(now()).toISOString(),
        },
      },
    };
  }

  const fake: FakeZoom = {
    oauthUrl: origin,
    apiUrl: `${origin}/v2`,
    origin,
    port,
    state,
    config,
    setFault(rule) {
      const installed: InstalledFault = { ...rule, id: nextFaultId++, hits: 0 };
      state.faults.push(installed);
      return installed;
    },
    clearFaults() {
      state.faults.length = 0;
    },
    reset() {
      state.meetings.clear();
      state.webinars.clear();
      state.registrants.clear();
      state.pastParticipants.clear();
      state.panelists.clear();
      state.tokens.length = 0;
      state.refreshTokens.clear();
      state.authCodes.clear();
      state.requestLog.length = 0;
      state.faults.length = 0;
      accessIndex.clear();
      clockOffsetMs = 0;
      nextEventNo = 1;
      nextSeq = 1;
      nextFaultId = 1;
      nextCodeNo = 1;
      rlWindowStart = 0;
      rlCount = 0;
      Object.assign(config, initial, { scopes: [...initial.scopes], rateLimit: initial.rateLimit ? { ...initial.rateLimit } : null });
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    expireAllTokens() {
      for (const t of state.tokens) t.forcedExpired = true;
    },
    advanceTime(ms) {
      clockOffsetMs += ms;
    },
    seedMeeting(input = {}) {
      return createEvent(input.kind ?? 'meeting', {
        ...input,
        ...(input.start_time ? { start_time: toZoomIso(input.start_time) ?? input.start_time } : {}),
      });
    },
    seedRegistrant(eventId, r) {
      return newRegistrant(resolveEvent(eventId), r);
    },
    seedPanelists(webinarId, panelists) {
      const ev = resolveEvent(webinarId);
      const list = state.panelists.get(ev.id) ?? [];
      for (const p of panelists) list.push({ id: rand(12), name: p.name, email: p.email, join_url: `${origin}/w/${ev.id}?pn=${rand(12)}` });
      state.panelists.set(ev.id, list);
      return list;
    },
    seedPastParticipants(meetingId, participants, o = {}) {
      const ev = resolveEvent(meetingId);
      const base = ev.start_time ? Date.parse(ev.start_time) : now();
      const list = o.replace ? [] : state.pastParticipants.get(ev.id) ?? [];
      for (const p of participants) {
        const join = p.join_time ?? new Date(base).toISOString();
        const leave = p.leave_time ?? new Date(Date.parse(join) + p.duration * 1000).toISOString();
        list.push({
          id: rand(12),
          user_id: rand(8),
          name: p.name,
          user_email: p.user_email ?? '',
          duration: p.duration,
          join_time: join,
          leave_time: leave,
        });
      }
      state.pastParticipants.set(ev.id, list);
      return list;
    },
    endMeeting(id) {
      const ev = resolveEvent(id);
      ev.status = 'ended';
      ev.end_time = new Date(now()).toISOString();
      return endedEvent(ev);
    },
    meetingEndedEvent(id) {
      return endedEvent(resolveEvent(id));
    },
    registrationCreatedEvent(eventId, registrant) {
      const ev = resolveEvent(eventId);
      const r = (state.registrants.get(ev.id) ?? []).find((x) => x.registrant_id === registrant || x.email.toLowerCase() === registrant.toLowerCase());
      if (!r) throw new Error(`fake zoom: no registrant ${registrant} on ${eventId}`);
      return {
        event: `${ev.kind}.registration_created`,
        event_ts: Date.now(),
        payload: {
          account_id: config.accountId,
          object: {
            id: String(ev.id),
            uuid: ev.uuid,
            host_id: ev.host_id,
            topic: ev.topic,
            type: ev.type,
            ...(ev.start_time ? { start_time: ev.start_time } : {}),
            timezone: ev.timezone,
            duration: ev.duration,
            registrant: {
              id: r.registrant_id,
              first_name: r.first_name,
              last_name: r.last_name,
              email: r.email,
              status: r.status,
              join_url: r.join_url,
              address: '',
              city: '',
              country: '',
              zip: '',
              state: '',
              phone: '',
              industry: '',
              org: '',
              job_title: '',
              comments: '',
            },
          },
        },
      };
    },
    sendWebhook: (appUrl, secret, event, o) => sendZoomWebhook(appUrl, secret, event, o),
    sendCrc: (appUrl, secret, o) => sendZoomCrc(appUrl, secret, o),
  };
  return fake;
}
