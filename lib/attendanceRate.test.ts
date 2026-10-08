import { describe, it, expect } from 'vitest';
import { attendanceRate, formatAttendanceRate } from './attendanceRate';

describe('attendanceRate — the single shared definition', () => {
  it('rates attendance against registered, not approved', () => {
    // 100 approved, 60 registered, 40 attended. The four formulas this
    // replaced produced 40%, 67%, 67% and 40% for exactly this campaign.
    expect(attendanceRate(40, 60)).toBe(67);
  });

  it('returns null rather than dividing by zero when nobody registered', () => {
    expect(attendanceRate(0, 0)).toBeNull();
    expect(attendanceRate(5, 0)).toBeNull();
  });

  it('returns null when attended exceeds registered instead of rendering >100%', () => {
    // Real case: a Zoom email matched someone who never completed registration.
    expect(attendanceRate(12, 10)).toBeNull();
  });

  it('handles the honest zero', () => {
    expect(attendanceRate(0, 50)).toBe(0);
  });

  it('rejects non-finite input rather than propagating NaN into the UI', () => {
    expect(attendanceRate(Number.NaN, 10)).toBeNull();
    expect(attendanceRate(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('formats with a shared dash fallback', () => {
    expect(formatAttendanceRate(40, 60)).toBe('67%');
    expect(formatAttendanceRate(0, 50)).toBe('0%');
    expect(formatAttendanceRate(5, 0)).toBe('—');
    expect(formatAttendanceRate(5, 0, '58%')).toBe('58%');
  });
});
