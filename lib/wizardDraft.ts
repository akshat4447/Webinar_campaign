// Pure rules for the creation wizard's autosave. No database, no network, no React: the server save, the
// beacon route, the client queue and the tests all share these, so they cannot drift apart.
//
// A draft save is a PATCH of changed fields, not a snapshot. Each field belongs to a conflict group; the
// server remembers the revision that last wrote each group, so two tabs editing different fields both
// survive and two tabs editing the same field are detected instead of silently overwritten.

import { DEFAULT_SELECTED_CHANNELS, CHANNEL_DEFINITIONS } from '@/lib/registrationChannels';
import { safeTimeZone } from '@/lib/dateFormat';
import { landingLinkError } from '@/lib/wizardValidation';

export const WIZARD_LAST_STEP = 5;
export const WIZARD_STEP_COUNT = WIZARD_LAST_STEP + 1;
/** A draft is created once the title reaches this many characters (or any other field is filled in). */
export const DRAFT_NAME_MIN = 3;

export interface DraftSpeaker {
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  linkedinUrl?: string | null;
  isPrimary?: boolean;
  order?: number;
}

export interface DraftStepConfig {
  mode?: 'ai' | 'template';
  templateId?: string | null;
  instruction?: string;
  customSubject?: string;
  customBody?: string;
}

/** Every field the wizard may autosave. Anything else in a patch is ignored. */
export interface DraftFields {
  title: string;
  description: string;
  date: string;
  time: string;
  timezone: string;
  durationMinutes: number;
  capacity: string;
  registrationLink: string;
  zoomLink: string;
  zoomMeetingId: string;
  speakers: DraftSpeaker[];
  selectedChannels: string[];
  scoringPrompt: string;
  scoringCriteria: string;
  scoringThreshold: number;
  msgMode: 'ai' | 'templatized';
  tone: string;
  msgLength: string;
  aiInstructions: string;
  brief: string;
  oneClickSignup: boolean;
  personalizationFields: string[];
}

export type DraftPatch = Partial<DraftFields> & {
  /** Per-step message settings; only the steps present are touched. */
  stepConfigs?: Record<string, DraftStepConfig>;
};

export const DRAFT_FIELD_KEYS = [
  'title', 'description', 'date', 'time', 'timezone', 'durationMinutes', 'capacity', 'registrationLink',
  'zoomLink', 'zoomMeetingId', 'speakers', 'selectedChannels', 'scoringPrompt',
  'scoringCriteria', 'scoringThreshold', 'msgMode', 'tone', 'msgLength', 'aiInstructions', 'brief',
  'oneClickSignup', 'personalizationFields',
] as const satisfies readonly (keyof DraftFields)[];

/**
 * Fields that must be saved together are one conflict group: date, time and zone describe one instant;
 * the registration link and the one-click switch describe one choice; the two Zoom fields one event.
 */
const GROUP_OF: Partial<Record<keyof DraftFields, string>> = {
  date: 'schedule',
  time: 'schedule',
  timezone: 'schedule',
  registrationLink: 'registration',
  oneClickSignup: 'registration',
  zoomLink: 'zoom',
  zoomMeetingId: 'zoom',
};

export function conflictGroupOf(key: keyof DraftFields): string {
  return GROUP_OF[key] ?? key;
}

/** The conflict groups a patch writes. Per-step configs are one group each. */
export function groupsInPatch(patch: DraftPatch): string[] {
  const groups = new Set<string>();
  for (const key of DRAFT_FIELD_KEYS) if (patch[key] !== undefined) groups.add(conflictGroupOf(key));
  for (const stepKey of Object.keys(patch.stepConfigs ?? {})) groups.add(`stepConfigs.${stepKey}`);
  return [...groups];
}

export function isEmptyPatch(patch: DraftPatch): boolean {
  return groupsInPatch(patch).length === 0;
}

// --- Sanitising ---------------------------------------------------------------------------------------

const MAX = {
  title: 200, description: 5000, link: 2000, meetingId: 64, name: 200, speakerText: 500, bio: 3000,
  scoringText: 4000, short: 100, longText: 8000, stepText: 4000, stepBody: 10000, subject: 300,
} as const;

const asText = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : undefined;

/** One-line text: no control characters and no line breaks. */
const asLine = (v: unknown, max: number): string | undefined => {
  const t = asText(v, max);
  return t === undefined ? undefined : t.replace(/[\r\n]+/g, ' ');
};

function asSpeakers(v: unknown): DraftSpeaker[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: DraftSpeaker[] = [];
  for (const raw of v.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const name = asLine(s.name, MAX.name);
    if (!name || !name.trim()) continue;
    out.push({
      name,
      title: asLine(s.title, MAX.speakerText) ?? null,
      company: asLine(s.company, MAX.speakerText) ?? null,
      bio: asText(s.bio, MAX.bio) ?? null,
      avatarUrl: asLine(s.avatarUrl, MAX.link) ?? null,
      linkedinUrl: asLine(s.linkedinUrl, MAX.link) ?? null,
      isPrimary: s.isPrimary === true,
      order: typeof s.order === 'number' && Number.isFinite(s.order) ? Math.trunc(s.order) : out.length,
    });
  }
  return out;
}

function asStringList(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
}

const STEP_KEY = /^[A-Za-z0-9_-]{1,64}$/;

function asStepConfigs(v: unknown): Record<string, DraftStepConfig> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, DraftStepConfig> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
    if (!STEP_KEY.test(key) || !raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const cfg: DraftStepConfig = {};
    if (c.mode === 'ai' || c.mode === 'template') cfg.mode = c.mode;
    if (c.templateId === null) cfg.templateId = null;
    else if (typeof c.templateId === 'string' && STEP_KEY.test(c.templateId)) cfg.templateId = c.templateId;
    const instruction = asText(c.instruction, MAX.stepText);
    if (instruction !== undefined) cfg.instruction = instruction;
    const subject = asLine(c.customSubject, MAX.subject);
    if (subject !== undefined) cfg.customSubject = subject;
    const body = asText(c.customBody, MAX.stepBody);
    if (body !== undefined) cfg.customBody = body;
    if (Object.keys(cfg).length > 0) out[key] = cfg;
  }
  return out;
}

/**
 * Turns whatever arrived over the wire into a patch containing only known fields with safe values.
 * Nothing is rejected for being incomplete: a draft may hold half-typed input. A field that cannot be
 * made safe is dropped from the patch rather than failing the save.
 */
export function sanitizeDraftPatch(raw: unknown): DraftPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const p: DraftPatch = {};

  const title = asLine(r.title, MAX.title); if (title !== undefined) p.title = title;
  const description = asText(r.description, MAX.description); if (description !== undefined) p.description = description;
  if (typeof r.date === 'string' && (r.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.date))) p.date = r.date;
  if (typeof r.time === 'string' && (r.time === '' || /^\d{2}:\d{2}$/.test(r.time))) p.time = r.time;
  if (typeof r.timezone === 'string' && r.timezone.trim()) p.timezone = safeTimeZone(r.timezone);
  if (typeof r.durationMinutes === 'number' && Number.isFinite(r.durationMinutes)) p.durationMinutes = Math.min(720, Math.max(5, Math.round(r.durationMinutes)));
  if (typeof r.capacity === 'string' && /^\d{0,9}$/.test(r.capacity.trim())) p.capacity = r.capacity.trim();
  // An address that is not a usable web address is not saved: the form says why, and the last good one stays.
  const link = asLine(r.registrationLink, MAX.link); if (link !== undefined && !landingLinkError(link)) p.registrationLink = link.trim();
  const zoomLink = asLine(r.zoomLink, MAX.link); if (zoomLink !== undefined) p.zoomLink = zoomLink.trim();
  const meetingId = asLine(r.zoomMeetingId, MAX.meetingId); if (meetingId !== undefined && /^[A-Za-z0-9_\- ]*$/.test(meetingId)) p.zoomMeetingId = meetingId.trim();
  const speakers = asSpeakers(r.speakers); if (speakers) p.speakers = speakers;
  const channels = asStringList(r.selectedChannels, 20, 40);
  if (channels) {
    const known = new Set<string>(Object.keys(CHANNEL_DEFINITIONS));
    const clean = [...new Set(channels.filter((c) => known.has(c)))];
    p.selectedChannels = clean.length > 0 ? clean : [...DEFAULT_SELECTED_CHANNELS];
  }
  const sp = asText(r.scoringPrompt, MAX.scoringText); if (sp !== undefined) p.scoringPrompt = sp;
  const sc = asText(r.scoringCriteria, MAX.scoringText); if (sc !== undefined) p.scoringCriteria = sc;
  if (typeof r.scoringThreshold === 'number' && Number.isFinite(r.scoringThreshold)) p.scoringThreshold = Math.min(100, Math.max(0, Math.round(r.scoringThreshold)));
  if (r.msgMode === 'ai' || r.msgMode === 'templatized') p.msgMode = r.msgMode;
  const tone = asLine(r.tone, MAX.short); if (tone !== undefined) p.tone = tone;
  const msgLength = asLine(r.msgLength, MAX.short); if (msgLength !== undefined) p.msgLength = msgLength;
  const ai = asText(r.aiInstructions, MAX.longText); if (ai !== undefined) p.aiInstructions = ai;
  const brief = asText(r.brief, MAX.longText); if (brief !== undefined) p.brief = brief;
  if (typeof r.oneClickSignup === 'boolean') p.oneClickSignup = r.oneClickSignup;
  const pf = asStringList(r.personalizationFields, 30, 40); if (pf) p.personalizationFields = pf;
  const stepConfigs = asStepConfigs(r.stepConfigs); if (stepConfigs && Object.keys(stepConfigs).length > 0) p.stepConfigs = stepConfigs;
  return p;
}

/** True for an http(s) URL. Used to decide whether a typed link switches registration to the external page. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// --- Creation threshold -------------------------------------------------------------------------------

/**
 * A stray click on New Webinar creates nothing. A draft exists once the title has {@link DRAFT_NAME_MIN}
 * characters, or any other field holds a value. The client sends only fields that differ from the form's
 * defaults, so "holds a value" is checked on the patch itself.
 */
export function shouldCreateDraft(patch: DraftPatch): boolean {
  if ((patch.title ?? '').trim().length >= DRAFT_NAME_MIN) return true;
  for (const key of DRAFT_FIELD_KEYS) {
    if (key === 'title') continue;
    const v = patch[key];
    if (v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return true;
  }
  return Object.keys(patch.stepConfigs ?? {}).length > 0;
}

// --- Merging and diffing ------------------------------------------------------------------------------

/** Later changes win; per-step configs merge per step so two bursts of typing never drop each other. */
export function mergePatches(a: DraftPatch, b: DraftPatch): DraftPatch {
  const merged: DraftPatch = { ...a, ...b };
  if (a.stepConfigs || b.stepConfigs) {
    const steps: Record<string, DraftStepConfig> = { ...(a.stepConfigs ?? {}) };
    for (const [k, v] of Object.entries(b.stepConfigs ?? {})) steps[k] = { ...(steps[k] ?? {}), ...v };
    merged.stepConfigs = steps;
  }
  return merged;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields of `next` that differ from `prev`: what a new autosave has to carry. A conflict group travels
 * whole (typing a time also sends the date and zone), so the server never has to combine half a schedule.
 */
export function diffDraftFields(prev: DraftFields, next: DraftFields): DraftPatch {
  const patch: Record<string, unknown> = {};
  for (const key of DRAFT_FIELD_KEYS) if (!same(prev[key], next[key])) patch[key] = next[key];
  const changed = new Set(Object.keys(patch).map((k) => conflictGroupOf(k as keyof DraftFields)));
  for (const key of DRAFT_FIELD_KEYS) if (changed.has(conflictGroupOf(key))) patch[key] = next[key];
  return patch as DraftPatch;
}

/** Applies a patch to a full set of field values (restoring unsaved edits, or adopting a newer server copy). */
export function applyPatchToFields(fields: DraftFields, patch: DraftPatch): DraftFields {
  const out: Record<string, unknown> = { ...fields };
  for (const key of DRAFT_FIELD_KEYS) if (patch[key] !== undefined) out[key] = patch[key];
  return out as unknown as DraftFields;
}

/** Subtracts what was just saved from what is still waiting, keeping anything edited again meanwhile. */
export function subtractPatch(pending: DraftPatch, saved: DraftPatch): DraftPatch {
  const rest: Record<string, unknown> = { ...pending };
  for (const key of DRAFT_FIELD_KEYS) if (saved[key] !== undefined && same(pending[key], saved[key])) delete rest[key];
  if (pending.stepConfigs) {
    const steps: Record<string, DraftStepConfig> = {};
    for (const [k, v] of Object.entries(pending.stepConfigs)) {
      if (!same(v, saved.stepConfigs?.[k])) steps[k] = v;
    }
    if (Object.keys(steps).length > 0) rest.stepConfigs = steps;
    else delete rest.stepConfigs;
  }
  return rest as DraftPatch;
}

// --- Conflicts ----------------------------------------------------------------------------------------

export type FieldRevs = Record<string, number>;

export function parseFieldRevs(raw: string | null | undefined): FieldRevs {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: FieldRevs = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch {
    return {};
  }
}

/**
 * What a writer has seen of each group. `base` is the revision it loaded the draft at; `groupBases` records,
 * per group, the revision of its own latest write (or of a conflict it resolved), because after that write it
 * knows that group's current value. A group it has not written and not resolved is still at `base`.
 */
export type GroupBases = Record<string, number>;

const seenRevision = (g: string, base: number, bases?: GroupBases) => Math.max(base, bases?.[g] ?? 0);

/** Groups the patch writes that someone else changed after the writer last saw them. */
export function conflictingGroups(patch: DraftPatch, revs: FieldRevs, base: number, bases?: GroupBases): string[] {
  return groupsInPatch(patch).filter((g) => (revs[g] ?? 0) > seenRevision(g, base, bases));
}

/** Groups changed by someone else that this patch did not write: the writer is now behind on them. */
export function remoteChangedGroups(patch: DraftPatch, revs: FieldRevs, base: number, bases?: GroupBases): string[] {
  const mine = new Set(groupsInPatch(patch));
  return Object.entries(revs).filter(([g, n]) => n > seenRevision(g, base, bases) && !mine.has(g)).map(([g]) => g);
}

export function sanitizeGroupBases(raw: unknown): GroupBases {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: GroupBases = {};
  for (const [g, n] of Object.entries(raw as Record<string, unknown>).slice(0, 80)) {
    if (g.length <= 100 && typeof n === 'number' && Number.isFinite(n) && n >= 0) out[g] = Math.trunc(n);
  }
  return out;
}

export function stampGroups(revs: FieldRevs, patch: DraftPatch, revision: number): FieldRevs {
  const next = { ...revs };
  for (const g of groupsInPatch(patch)) next[g] = revision;
  return next;
}

// --- Steps --------------------------------------------------------------------------------------------

export function clampStep(step: unknown): number {
  const n = typeof step === 'number' ? step : Number.parseInt(String(step ?? ''), 10);
  return Number.isFinite(n) ? Math.min(WIZARD_LAST_STEP, Math.max(0, Math.trunc(n))) : 0;
}

/** Furthest step stays a high-water mark: going back never lowers it. */
export function nextFurthestStep(current: number, step: number): number {
  return Math.max(clampStep(current), clampStep(step));
}

export const WIZARD_STEP_NAMES = ['Details', 'Audience', 'Scoring', 'Cadence', 'Messaging', 'Review'] as const;

export function wizardResumeHref(c: { id: string; wizardStep?: number | null }): string {
  return `/campaigns/new?id=${encodeURIComponent(c.id)}&step=${clampStep(c.wizardStep ?? 0)}`;
}

/** "Step 3 of 6" for a draft's stored position. */
export function wizardStepLabel(step: number | null | undefined): string {
  return `Step ${clampStep(step ?? 0) + 1} of ${WIZARD_STEP_COUNT}`;
}

/** Share of the wizard reached, as a whole percent, for the thin progress bar on a draft card. */
export function wizardProgressPercent(furthest: number | null | undefined): number {
  return Math.round(((clampStep(furthest ?? 0) + 1) / WIZARD_STEP_COUNT) * 100);
}

// --- Returning from Integrations ----------------------------------------------------------------------

/**
 * A `returnTo` value travels through query strings and OAuth state, so it is treated as hostile input. Only
 * two same-site shapes are accepted, and the result is rebuilt from parsed parts rather than echoed:
 *   /campaigns/new?id=<id>&step=<n>
 *   /campaigns/<id>/<tab>
 * Returns the canonical path, or null when the value is anything else.
 */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, 'http://return.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://return.invalid') return null;
  // A path that only looks safe after decoding (`/%2F/evil`, `/%5Cevil`) is refused as well.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded !== url.pathname || decoded.startsWith('//') || decoded.includes('\\')) return null;

  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  if (url.pathname === '/campaigns/new') {
    const id = url.searchParams.get('id');
    if (!id || !ID.test(id)) return null;
    const stepRaw = url.searchParams.get('step');
    const step = stepRaw === null ? null : /^\d$/.test(stepRaw) ? clampStep(stepRaw) : NaN;
    if (Number.isNaN(step)) return null;
    const q = new URLSearchParams({ id });
    if (step !== null) q.set('step', String(step));
    return `/campaigns/new?${q}`;
  }
  const m = /^\/campaigns\/([A-Za-z0-9_-]{1,64})\/([a-z-]{1,32})$/.exec(url.pathname);
  if (m && m[1] !== 'new') return `/campaigns/${m[1]}/${m[2]}`;
  return null;
}

/** The webinar a validated returnTo points at, for the "Back to <webinar>" bar. */
export function returnTarget(returnTo: string | null): { id: string; step: number | null } | null {
  if (!returnTo) return null;
  const url = new URL(returnTo, 'http://return.invalid');
  if (url.pathname === '/campaigns/new') {
    const id = url.searchParams.get('id');
    const step = url.searchParams.get('step');
    return id ? { id, step: step === null ? null : clampStep(step) } : null;
  }
  const m = /^\/campaigns\/([^/]+)\//.exec(url.pathname);
  return m ? { id: m[1], step: null } : null;
}

/** Link to Integrations that remembers where to come back to. */
export function integrationsHref(returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo ?? null);
  return safe ? `/integrations?returnTo=${encodeURIComponent(safe)}` : '/integrations';
}

// --- Resume window ------------------------------------------------------------------------------------

export const RECENT_DRAFT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const ABANDONED_DRAFT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function draftActivityAt(c: { draftTouchedAt?: Date | null; updatedAt: Date }): Date {
  return c.draftTouchedAt ?? c.updatedAt;
}

// --- Save results -------------------------------------------------------------------------------------

export type SaveDraftResult =
  | { status: 'saved'; campaignId: string; revision: number; created: boolean; remoteGroups: string[] }
  | { status: 'skipped' }
  | { status: 'conflict'; campaignId: string; revision: number; groups: string[] }
  | { status: 'locked'; campaignId: string }
  | { status: 'gone' };

/** The groups a conflict names, as words for the status label. */
export function describeGroups(groups: string[]): string {
  const label: Record<string, string> = {
    title: 'title', description: 'description', schedule: 'date and time', durationMinutes: 'duration', capacity: 'capacity',
    registration: 'registration page', zoom: 'Zoom link', speakers: 'speakers',
    selectedChannels: 'channels', scoringPrompt: 'scoring prompt', scoringCriteria: 'scoring criteria',
    scoringThreshold: 'score threshold', msgMode: 'message mode', tone: 'tone', msgLength: 'message length',
    aiInstructions: 'AI instructions', brief: 'brief', personalizationFields: 'personalization fields',
  };
  const names = [...new Set(groups.map((g) => label[g] ?? (g.startsWith('stepConfigs.') ? 'message settings' : g)))];
  return names.join(', ');
}
