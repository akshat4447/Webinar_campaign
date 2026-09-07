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
