import { describe, it, expect } from 'vitest';
import { formatWebinarDate, toDateTimeLocal, parseLegacyWebinarDate, reminderDates } from './campaignDate';

describe('formatWebinarDate', () => {
  it('renders month/day/year, 12-hour time, and the IST label', () => {
    const d = new Date(2026, 7, 28, 15, 0); // Aug 28 2026, 3:00 PM, local
    expect(formatWebinarDate(d)).toBe('Aug 28, 2026 · 3:00 PM IST');
  });

  it('pads minutes and keeps a two-digit hour for midday times', () => {
    const d = new Date(2026, 0, 5, 9, 5);
    expect(formatWebinarDate(d)).toBe('Jan 5, 2026 · 9:05 AM IST');
  });
});

describe('toDateTimeLocal', () => {
  it('formats a Date as a zero-padded datetime-local value', () => {
    const d = new Date(2026, 7, 28, 9, 5);
    expect(toDateTimeLocal(d)).toBe('2026-08-28T09:05');
  });

  it('returns an empty string for null — an unscheduled campaign has nothing to prefill', () => {
    expect(toDateTimeLocal(null)).toBe('');
  });

  it('round-trips through formatWebinarDate\'s own construction (same local wall-clock fields)', () => {
    const d = new Date(2026, 11, 31, 23, 59);
    expect(toDateTimeLocal(d)).toBe('2026-12-31T23:59');
  });
});

describe('parseLegacyWebinarDate', () => {
  it('parses a display string, stripping the separator dot and timezone label', () => {
    const parsed = parseLegacyWebinarDate('Aug 28, 2026 · 3:00 PM IST');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(7);
    expect(parsed!.getDate()).toBe(28);
  });

  it('returns null for an empty or garbage string rather than an Invalid Date', () => {
    expect(parseLegacyWebinarDate('')).toBeNull();
    expect(parseLegacyWebinarDate('asdasd')).toBeNull();
    expect(parseLegacyWebinarDate('Not scheduled yet')).toBeNull();
  });

  it('strips other recognized timezone labels too', () => {
    const parsed = parseLegacyWebinarDate('Jun 12, 2026 · 9:00 AM PST');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
  });
});

describe('reminderDates', () => {
  it('offsets t3/t1d/t1h backward from the event, and keeps the event time itself', () => {
    const event = new Date(2026, 7, 28, 15, 0);
    const { t3, t1d, t1h, event: e } = reminderDates(event);
    expect(t3.getDate()).toBe(25);
    expect(t1d.getDate()).toBe(27);
    expect(t1h.getHours()).toBe(14);
    expect(t1h.getDate()).toBe(28);
    expect(e.getTime()).toBe(event.getTime());
  });

  it('returns a new Date instance for "event", not the same reference (so mutating one never mutates the input)', () => {
    const event = new Date(2026, 7, 28, 15, 0);
    const { event: e } = reminderDates(event);
    expect(e).not.toBe(event);
    e.setFullYear(1999);
    expect(event.getFullYear()).toBe(2026);
  });
});
