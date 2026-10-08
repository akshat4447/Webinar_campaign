export type Anchor = 'launch' | 'webinar' | 'event';
export type OffsetUnit = 'days' | 'hours' | 'minutes';

export interface StepSchedule {
  offsetValue: number;
  offsetUnit: string;
  anchor: string;
}

/** Default offsets per step key — the shape the seeded cadence starts from. */
export const STEP_DEFAULTS: Record<string, StepSchedule> = {
  invite: { offsetValue: 0, offsetUnit: 'days', anchor: 'launch' },
  smsInvite: { offsetValue: 0, offsetUnit: 'days', anchor: 'launch' },
  waInvite: { offsetValue: 0, offsetUnit: 'days', anchor: 'launch' },
  linkedin: { offsetValue: 1, offsetUnit: 'days', anchor: 'launch' },
  nudge: { offsetValue: 4, offsetUnit: 'days', anchor: 'launch' },
  final: { offsetValue: 7, offsetUnit: 'days', anchor: 'launch' },
  confirm: { offsetValue: 0, offsetUnit: 'hours', anchor: 'event' },
  t3: { offsetValue: -3, offsetUnit: 'days', anchor: 'webinar' },
  t1d: { offsetValue: -1, offsetUnit: 'days', anchor: 'webinar' },
  t1h: { offsetValue: -1, offsetUnit: 'hours', anchor: 'webinar' },
  attend: { offsetValue: 2, offsetUnit: 'hours', anchor: 'webinar' },
  noshow: { offsetValue: 2, offsetUnit: 'hours', anchor: 'webinar' },
  whatsapp: { offsetValue: 0, offsetUnit: 'days', anchor: 'event' },
  sms: { offsetValue: -1, offsetUnit: 'hours', anchor: 'webinar' },
  doors_open: { offsetValue: -15, offsetUnit: 'minutes', anchor: 'webinar' },
};

/** Default instructions per step key matching the prototype flow */
export const STEP_DEFAULT_INSTRUCTIONS: Record<string, string> = {
  invite: 'First touch to approved contacts.',
  nudge: 'Follow-up to those who haven\u2019t registered yet.',
  waInvite: 'Follow-up to those who haven\u2019t registered yet.',
  smsInvite: 'Follow-up to those who haven\u2019t registered yet.',
  final: 'Follow-up to those who haven\u2019t registered yet.',
  confirm: 'Calendar invite + join link, the moment they register.',
  t3: 'What the session covers, keep it warm.',
  t1d: 'Don\u2019t-forget nudge with join link.',
  t1h: '\u201cWe\u2019re live in an hour\u201d with the join link.',
  doors_open: 'Doors are opening now for live session.',
  attend: 'Thanks for joining — recording + next-step CTA (book a demo).',
  noshow: '\u201cSorry we missed you\u201d — the on-demand recording to watch anytime.',
  whatsapp: 'Opt-in confirmation with the join link, the moment they register.',
  sms: '\u201cWe\u2019re live in an hour\u201d with the join link.',
};

/**
 * Parses user input like "T-5 days", "T-3d", "T-1 hour", "T-15m", "Instant", "Day 0", "+4 days"
 * into structured offset and anchor values.
 */
export function parseTimingString(
  raw: string,
  fallback: { offsetValue: number; offsetUnit: string; anchor: string }
): { offsetValue: number; offsetUnit: string; anchor: string } {
  const s = raw.trim();
  if (!s) return fallback;

  if (/^(instant\s*\((on\s*)?launch\)|immediate|on launch|at launch)$/i.test(s)) {
    return { offsetValue: 0, offsetUnit: 'hours', anchor: 'launch' };
  }
  if (/^(instant|on registration)$/i.test(s)) {
    return { offsetValue: 0, offsetUnit: 'hours', anchor: 'event' };
  }
  if (/^day\s*0$/i.test(s)) {
    return { offsetValue: 0, offsetUnit: 'days', anchor: 'launch' };
  }

  // T-X days/hours/minutes
  const tMatch = s.match(/^T-(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)$/i);
  if (tMatch) {
    const val = -parseInt(tMatch[1], 10);
    const u = tMatch[2].toLowerCase();
    const unit = u.startsWith('m') ? 'minutes' : u.startsWith('h') ? 'hours' : 'days';
    return { offsetValue: val, offsetUnit: unit, anchor: 'webinar' };
  }

  // +X days/hours/minutes
  const plusMatch = s.match(/^\+(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)$/i);
  if (plusMatch) {
    const val = parseInt(plusMatch[1], 10);
    const u = plusMatch[2].toLowerCase();
    const unit = u.startsWith('m') ? 'minutes' : u.startsWith('h') ? 'hours' : 'days';
    const anchor = fallback.anchor === 'launch' ? 'launch' : 'webinar';
    return { offsetValue: val, offsetUnit: unit, anchor };
  }

  // Pure number
  const numMatch = s.match(/^-?(\d+)$/);
  if (numMatch) {
    return { ...fallback, offsetValue: parseInt(s, 10) };
  }

  return fallback;
}

export function applyOffset(base: Date, offsetValue: number, offsetUnit: string): Date {
  const d = new Date(base);
  if (offsetUnit === 'minutes') d.setMinutes(d.getMinutes() + offsetValue);
  else if (offsetUnit === 'hours') d.setHours(d.getHours() + offsetValue);
  else d.setDate(d.getDate() + offsetValue);
  return d;
}

/**
 * Resolves a step's offset into a real timestamp. Returns null when the anchor
 * can't be resolved — an event-triggered step has no clock, and a webinar-anchored
 * step needs the campaign to actually have a date set.
 */
export function resolveStepDate(step: StepSchedule, opts: { launchAt: Date; webinarAt: Date | null }): Date | null {
  if (step.anchor === 'event') return null;
  const base = step.anchor === 'webinar' ? opts.webinarAt : opts.launchAt;
  if (!base) return null;
  return applyOffset(base, step.offsetValue, step.offsetUnit);
}

/** Human label for the offset, e.g. "Day 0", "+4 days", "T-3 days", "+2 hours". */
export function offsetLabel(step: StepSchedule): string {
  if (step.anchor === 'event') return 'On trigger';
  const unit = step.offsetUnit === 'minutes' ? 'min' : step.offsetUnit === 'hours' ? 'hour' : 'day';
  const n = Math.abs(step.offsetValue);
  const plural = step.offsetUnit === 'minutes' ? 'mins' : (n === 1 ? unit : `${unit}s`);

  if (step.anchor === 'webinar') {
    if (step.offsetValue === 0) return 'At start';
    return step.offsetValue < 0 ? `T-${n} ${plural}` : `+${n} ${plural} after`;
  }
  if (step.offsetValue === 0) return 'Day 0';
  return `+${n} ${plural}`;
}

export const ANCHOR_LABEL: Record<string, string> = {
  launch: 'after launch',
  webinar: 'from webinar start',
  event: 'when triggered',
};

/**
 * Day-offsets the "Cadence preset" selector on the Schedule tab claims for
 * nudge/final-call ("invite, +4d nudge, +7d final call" etc. — see the gapLabel
 * text in ScheduleConfig.tsx, which these numbers must stay in sync with).
 * Previously picking a preset only changed that description string; it now
 * actually rewrites the two steps' offsets to match what it says.
 */
export const FREQUENCY_PRESETS: Record<string, { nudge: number; final: number }> = {
  aggressive: { nudge: 2, final: 4 },
  balanced: { nudge: 4, final: 7 },
  relaxed: { nudge: 6, final: 10 },
};

/**
 * Canonical lifecycle sequence for webinar cadence steps.
 * Sorts steps chronologically from pre-registration outreach to post-webinar follow-ups.
 */
export const CANONICAL_STEP_ORDER: Record<string, number> = {
  invite: 10,
  smsInvite: 15,
  waInvite: 16,
  linkedin: 20,
  nudge: 30,
  final: 40,
  confirm: 50,
  whatsapp: 55,
  t3: 60,
  t1d: 70,
  t1h: 80,
  sms: 85,
  doors_open: 90,
  attend: 100,
  noshow: 110,
};

export function compareCadenceSteps<T extends { key?: string; id?: string }>(a: T, b: T): number {
  const keyA = a.key || a.id || '';
  const keyB = b.key || b.id || '';
  const orderA = CANONICAL_STEP_ORDER[keyA] ?? 999;
  const orderB = CANONICAL_STEP_ORDER[keyB] ?? 999;
  return orderA - orderB;
}
