import { isAutomatableChannel } from './channels';

/**
 * What causes a cadence step's sends to be queued.
 *
 * Deliberately separate from `anchor` (lib/stepSchedule.ts), which only says
 * what a step's due *date* is measured from. The two are independent: `attend`
 * and `noshow` are both webinar-anchored, yet neither can be queued at launch,
 * because at launch nothing knows who attended.
 */
export type StepTrigger = 'launch' | 'registration' | 'attendance';

export const STEP_TRIGGERS: StepTrigger[] = ['launch', 'registration', 'attendance'];

/** Defaults for the built-in steps. Anything absent is 'launch'. */
export const TRIGGER_DEFAULTS: Record<string, StepTrigger> = {
  confirm: 'registration',
  whatsapp: 'registration',
  attend: 'attendance',
  noshow: 'attendance',
};

export function defaultTriggerFor(stepKey: string): StepTrigger {
  return TRIGGER_DEFAULTS[stepKey] ?? 'launch';
}

/** Built-in pre-webinar reminder countdown steps that require registeredAt before sending. */
export const PRE_WEBINAR_REMINDER_KEYS = new Set(['t3', 't1d', 't1h', 'sms', 'doors_open']);

export function isPreWebinarReminder(stepKey: string): boolean {
  return PRE_WEBINAR_REMINDER_KEYS.has(stepKey);
}

export function isStepTrigger(value: string): value is StepTrigger {
  return (STEP_TRIGGERS as string[]).includes(value);
}

export interface TriggerableStep {
  trigger: string;
  channel: string;
  enabled: boolean;
}

/**
 * Whether this step's sends are queued when the cadence launches.
 *
 * This replaced a hardcoded allowlist of step keys in lib/cadence.ts. That
 * allowlist could not describe a step the operator invented in the planner, so
 * such a step rendered correctly, reported itself enabled, and then silently
 * never sent anything — a failure with nothing to fail, and so nothing to see.
 *
 * The rule is now a property of the step: queue it at launch when its audience
 * is already known (`trigger === 'launch'`) and its channel is one the app can
 * actually send. Registration- and attendance-triggered steps are queued by
 * those code paths instead, because only they know who the audience is.
 */
export function isLaunchQueued(step: TriggerableStep): boolean {
  return step.enabled && step.trigger === 'launch' && isAutomatableChannel(step.channel);
}
