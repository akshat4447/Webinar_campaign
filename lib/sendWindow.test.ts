import { describe, it, expect } from 'vitest';
import { parseSendWindow, formatSendWindow, isWithinSendWindow } from './sendWindow';

describe('parseSendWindow', () => {
  it('parses the canonical 24-hour form written by the Schedule tab', () => {
    expect(parseSendWindow('09:00–18:00')).toEqual({ startMinutes: 540, endMinutes: 1080 });
  });

  it('accepts a plain hyphen as well as an en dash', () => {
    expect(parseSendWindow('09:00-18:00')).toEqual({ startMinutes: 540, endMinutes: 1080 });
  });

  it('parses the legacy free-text display string old campaigns may still hold', () => {
    expect(parseSendWindow('9:00 AM – 6:00 PM IST')).toEqual({ startMinutes: 540, endMinutes: 1080 });
  });

  it('returns null for unparseable input', () => {
    expect(parseSendWindow('whenever works')).toBeNull();
  });
});

describe('formatSendWindow', () => {
  it('renders back to a friendly 12-hour label', () => {
    expect(formatSendWindow({ startMinutes: 540, endMinutes: 1080 })).toBe('9:00 AM – 6:00 PM');
  });

  it('handles midnight and noon correctly', () => {
    expect(formatSendWindow({ startMinutes: 0, endMinutes: 720 })).toBe('12:00 AM – 12:00 PM');
  });
});

describe('isWithinSendWindow', () => {
  it('is true inside a normal same-day window', () => {
    const at = new Date('2026-01-01T12:00:00'); // noon local
    expect(isWithinSendWindow(at, '09:00–18:00')).toBe(true);
  });

  it('is false before the window opens', () => {
    const at = new Date('2026-01-01T03:00:00');
    expect(isWithinSendWindow(at, '09:00–18:00')).toBe(false);
  });

  it('is false after the window closes', () => {
    const at = new Date('2026-01-01T22:00:00');
    expect(isWithinSendWindow(at, '09:00–18:00')).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const lateNight = new Date('2026-01-01T23:00:00');
    const earlyMorning = new Date('2026-01-01T01:00:00');
    const midday = new Date('2026-01-01T12:00:00');
    expect(isWithinSendWindow(lateNight, '22:00–02:00')).toBe(true);
    expect(isWithinSendWindow(earlyMorning, '22:00–02:00')).toBe(true);
    expect(isWithinSendWindow(midday, '22:00–02:00')).toBe(false);
  });

  it('treats an unparseable or unset window as always open — never blocks on a config it cannot read', () => {
    const at = new Date('2026-01-01T03:00:00');
    expect(isWithinSendWindow(at, 'garbage')).toBe(true);
  });

  it('treats a zero-width window (start === end) as always open', () => {
    const at = new Date('2026-01-01T03:00:00');
    expect(isWithinSendWindow(at, '09:00–09:00')).toBe(true);
  });

  it('correctly evaluates against Asia/Kolkata timezone regardless of host clock', () => {
    // 04:00 UTC = 09:30 AM IST (inside 09:00–18:00 IST)
    const morningUtc = new Date('2026-01-01T04:00:00.000Z');
    expect(isWithinSendWindow(morningUtc, '09:00–18:00', 'Asia/Kolkata')).toBe(true);

    // 17:00 UTC = 22:30 PM IST (outside 09:00–18:00 IST)
    const nightUtc = new Date('2026-01-01T17:00:00.000Z');
    expect(isWithinSendWindow(nightUtc, '09:00–18:00', 'Asia/Kolkata')).toBe(false);

    // 03:00 UTC = 08:30 AM IST (before 09:00 AM IST)
    const earlyUtc = new Date('2026-01-01T03:00:00.000Z');
    expect(isWithinSendWindow(earlyUtc, '09:00–18:00', 'Asia/Kolkata')).toBe(false);
  });

  it('automatically detects IST in legacy window strings and applies Asia/Kolkata', () => {
    // 04:00 UTC = 09:30 AM IST
    const morningUtc = new Date('2026-01-01T04:00:00.000Z');
    expect(isWithinSendWindow(morningUtc, '9:00 AM – 6:00 PM IST')).toBe(true);

    // 17:00 UTC = 22:30 PM IST
    const nightUtc = new Date('2026-01-01T17:00:00.000Z');
    expect(isWithinSendWindow(nightUtc, '9:00 AM – 6:00 PM IST')).toBe(false);
  });
});
