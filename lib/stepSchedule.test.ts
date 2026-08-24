import { describe, it, expect } from 'vitest';
import { applyOffset, resolveStepDate, offsetLabel, STEP_DEFAULTS, FREQUENCY_PRESETS } from './stepSchedule';

describe('applyOffset', () => {
  it('adds whole days', () => {
    const base = new Date('2026-01-01T10:00:00.000Z');
    expect(applyOffset(base, 4, 'days').toISOString()).toBe('2026-01-05T10:00:00.000Z');
  });

  it('subtracts hours for a negative offset', () => {
    const base = new Date('2026-01-01T10:00:00.000Z');
    expect(applyOffset(base, -3, 'hours').toISOString()).toBe('2026-01-01T07:00:00.000Z');
  });
});

describe('resolveStepDate', () => {
  const launchAt = new Date('2026-01-01T00:00:00.000Z');
  const webinarAt = new Date('2026-01-10T15:00:00.000Z');

  it('returns null for an event-anchored step — it has no clock', () => {
    expect(resolveStepDate({ offsetValue: 0, offsetUnit: 'hours', anchor: 'event' }, { launchAt, webinarAt })).toBeNull();
  });

  it('returns null for a webinar-anchored step when no webinar date is set', () => {
    expect(resolveStepDate({ offsetValue: -3, offsetUnit: 'days', anchor: 'webinar' }, { launchAt, webinarAt: null })).toBeNull();
  });

  it('resolves a webinar-anchored reminder relative to the webinar date', () => {
    const resolved = resolveStepDate({ offsetValue: -3, offsetUnit: 'days', anchor: 'webinar' }, { launchAt, webinarAt });
    expect(resolved?.toISOString()).toBe('2026-01-07T15:00:00.000Z');
  });

  it('resolves a launch-anchored step relative to launch time', () => {
    const resolved = resolveStepDate({ offsetValue: 4, offsetUnit: 'days', anchor: 'launch' }, { launchAt, webinarAt });
    expect(resolved?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});

describe('offsetLabel', () => {
  it('labels an event trigger as "On trigger"', () => {
    expect(offsetLabel({ offsetValue: 0, offsetUnit: 'hours', anchor: 'event' })).toBe('On trigger');
  });

  it('labels a T-minus webinar offset', () => {
    expect(offsetLabel({ offsetValue: -3, offsetUnit: 'days', anchor: 'webinar' })).toBe('T-3 days');
  });

  it('labels webinar start with zero offset as "At start"', () => {
    expect(offsetLabel({ offsetValue: 0, offsetUnit: 'hours', anchor: 'webinar' })).toBe('At start');
  });

  it('labels a launch-anchored offset as "+N days"', () => {
    expect(offsetLabel({ offsetValue: 4, offsetUnit: 'days', anchor: 'launch' })).toBe('+4 days');
  });
});

describe('FREQUENCY_PRESETS', () => {
  it('matches the gap-label text shown in the Schedule tab UI', () => {
    // ScheduleConfig.tsx's gapLabel claims these exact day counts per preset —
    // this pins the two in sync so a future edit to one surfaces in the other.
    expect(STEP_DEFAULTS.nudge.offsetValue).toBe(FREQUENCY_PRESETS.balanced.nudge);
    expect(STEP_DEFAULTS.final.offsetValue).toBe(FREQUENCY_PRESETS.balanced.final);
    expect(FREQUENCY_PRESETS.aggressive).toEqual({ nudge: 2, final: 4 });
    expect(FREQUENCY_PRESETS.relaxed).toEqual({ nudge: 6, final: 10 });
  });
});
