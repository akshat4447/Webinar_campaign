import { describe, it, expect } from 'vitest';
import { parseTimingString, resolveStepDate, offsetLabel } from './stepSchedule';

describe('Cadence Timing Configuration & Instant Scheduling', () => {
  const fallbackLaunch = { offsetValue: 0, offsetUnit: 'days', anchor: 'launch' };

  it('parses "Instant (on launch)" and "Immediate" into anchor: launch with 0 offset', () => {
    const instant1 = parseTimingString('Instant (on launch)', fallbackLaunch);
    expect(instant1).toEqual({
      offsetValue: 0,
      offsetUnit: 'hours',
      anchor: 'launch',
    });

    const instant2 = parseTimingString('Immediate', fallbackLaunch);
    expect(instant2).toEqual({
      offsetValue: 0,
      offsetUnit: 'hours',
      anchor: 'launch',
    });

    const instant3 = parseTimingString('On launch', fallbackLaunch);
    expect(instant3).toEqual({
      offsetValue: 0,
      offsetUnit: 'hours',
      anchor: 'launch',
    });
  });

  it('resolves instant step date immediately to launchAt time', () => {
    const launchAt = new Date('2026-10-01T10:00:00.000Z');
    const webinarAt = new Date('2026-10-10T14:00:00.000Z');

    const instantStep = {
      offsetValue: 0,
      offsetUnit: 'hours',
      anchor: 'launch',
    };

    const resolved = resolveStepDate(instantStep, { launchAt, webinarAt });
    expect(resolved?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('resolves launch-relative days correctly', () => {
    const launchAt = new Date('2026-10-01T10:00:00.000Z');
    const webinarAt = new Date('2026-10-10T14:00:00.000Z');

    const step2d = {
      offsetValue: 2,
      offsetUnit: 'days',
      anchor: 'launch',
    };

    const resolved = resolveStepDate(step2d, { launchAt, webinarAt });
    expect(resolved?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
  });

  it('resolves webinar countdown reminders (T-minus)', () => {
    const launchAt = new Date('2026-10-01T10:00:00.000Z');
    const webinarAt = new Date('2026-10-10T14:00:00.000Z');

    const t1d = {
      offsetValue: -1,
      offsetUnit: 'days',
      anchor: 'webinar',
    };
    expect(resolveStepDate(t1d, { launchAt, webinarAt })?.toISOString()).toBe('2026-10-09T14:00:00.000Z');

    const t1h = {
      offsetValue: -1,
      offsetUnit: 'hours',
      anchor: 'webinar',
    };
    expect(resolveStepDate(t1h, { launchAt, webinarAt })?.toISOString()).toBe('2026-10-10T13:00:00.000Z');

    const doors = {
      offsetValue: -15,
      offsetUnit: 'minutes',
      anchor: 'webinar',
    };
    expect(resolveStepDate(doors, { launchAt, webinarAt })?.toISOString()).toBe('2026-10-10T13:45:00.000Z');
  });

  it('resolves post-webinar follow-ups', () => {
    const launchAt = new Date('2026-10-01T10:00:00.000Z');
    const webinarAt = new Date('2026-10-10T14:00:00.000Z');

    const post2h = {
      offsetValue: 2,
      offsetUnit: 'hours',
      anchor: 'webinar',
    };
    expect(resolveStepDate(post2h, { launchAt, webinarAt })?.toISOString()).toBe('2026-10-10T16:00:00.000Z');
  });

  it('correctly labels offsets', () => {
    expect(offsetLabel({ offsetValue: 0, offsetUnit: 'days', anchor: 'launch' })).toBe('Day 0');
    expect(offsetLabel({ offsetValue: 2, offsetUnit: 'days', anchor: 'launch' })).toBe('+2 days');
    expect(offsetLabel({ offsetValue: -3, offsetUnit: 'days', anchor: 'webinar' })).toBe('T-3 days');
    expect(offsetLabel({ offsetValue: -1, offsetUnit: 'hours', anchor: 'webinar' })).toBe('T-1 hour');
    expect(offsetLabel({ offsetValue: -15, offsetUnit: 'minutes', anchor: 'webinar' })).toBe('T-15 mins');
    expect(offsetLabel({ offsetValue: 0, offsetUnit: 'hours', anchor: 'event' })).toBe('On trigger');
  });
});
