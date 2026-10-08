import { describe, it, expect } from 'vitest';
import { DEFAULT_TIMEZONE, formatLsqDate, formatLsqDateTime, formatLsqTime, safeTimeZone, timeZoneLabel, wallClockToDate, dateToWallClock } from './dateFormat';

const d = new Date('2026-10-21T09:30:00Z'); // 15:00 IST, 05:30 EDT, 02:30 PDT

describe('formatLsqDateTime (design-system format)', () => {
  it('formats as "21 Oct 2026 | 03:00 PM" in the given zone', () => {
    expect(formatLsqDateTime(d, 'Asia/Kolkata')).toBe('21 Oct 2026 | 03:00 PM');
    expect(formatLsqDateTime(d, 'America/New_York')).toBe('21 Oct 2026 | 05:30 AM');
    expect(formatLsqDateTime(d, 'America/Los_Angeles')).toBe('21 Oct 2026 | 02:30 AM');
  });
  it('does not zero-pad the day but zero-pads the hour', () => {
    expect(formatLsqDate(new Date('2026-01-05T10:00:00Z'), 'UTC')).toBe('5 Jan 2026');
    expect(formatLsqTime(new Date('2026-01-05T09:05:00Z'), 'UTC')).toBe('09:05 AM');
  });
  it('handles midnight and noon correctly', () => {
    expect(formatLsqTime(new Date('2026-01-05T00:00:00Z'), 'UTC')).toBe('12:00 AM');
    expect(formatLsqTime(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe('12:00 PM');
  });
  it('rolls the date with the zone (a late-evening UTC time is already tomorrow in IST)', () => {
    expect(formatLsqDateTime(new Date('2026-12-31T20:00:00Z'), 'Asia/Kolkata')).toBe('1 Jan 2027 | 01:30 AM');
  });
  it('uses the default zone for a missing or invalid zone name instead of throwing', () => {
    expect(safeTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone('Not/AZone')).toBe(DEFAULT_TIMEZONE);
    expect(formatLsqDateTime(d, 'Not/AZone')).toBe('21 Oct 2026 | 03:00 PM');
  });
  it('shows a dash for missing or invalid dates', () => {
    expect(formatLsqDateTime(null)).toBe('—');
    expect(formatLsqDateTime(new Date('nope'))).toBe('—');
  });
  it('labels the zone', () => {
    expect(timeZoneLabel(d, 'Asia/Kolkata')).toMatch(/IST|GMT\+5:30/);
  });
});


describe('wallClockToDate / dateToWallClock', () => {
  it('reads wall-clock time in the webinar zone, not the server zone', () => {
    expect(wallClockToDate('2026-10-21T15:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-10-21T09:30:00.000Z');
    expect(wallClockToDate('2026-10-21T15:00', 'UTC')?.toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(wallClockToDate('2026-01-15T09:00', 'America/New_York')?.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
  it('honours daylight saving on both sides of the change', () => {
    expect(wallClockToDate('2026-07-15T09:00', 'America/New_York')?.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });
  it('round-trips', () => {
    for (const tz of ['Asia/Kolkata', 'Europe/London', 'America/Los_Angeles', 'Australia/Sydney']) {
      const d = wallClockToDate('2026-03-08T01:30', tz) as Date;
      expect(dateToWallClock(d, tz)).toBe('2026-03-08T01:30');
    }
  });
  it('rejects invalid input and rolled-over dates', () => {
    expect(wallClockToDate('nonsense', 'UTC')).toBeNull();
    expect(wallClockToDate('2026-02-31T10:00', 'UTC')).toBeNull();
    expect(wallClockToDate('', 'UTC')).toBeNull();
  });
  it('falls back to the default zone for an unknown name', () => {
    expect(wallClockToDate('2026-10-21T15:00', 'Not/AZone')?.toISOString()).toBe('2026-10-21T09:30:00.000Z');
  });
});
