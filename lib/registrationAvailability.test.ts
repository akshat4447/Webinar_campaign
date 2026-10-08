import { describe, it, expect } from 'vitest';
import { registrationAvailability, LATE_JOIN_GRACE_MIN } from './registrationAvailability';

const start = new Date('2026-10-21T09:30:00Z');
const at = (minAfterStart: number) => new Date(start.getTime() + minAfterStart * 60_000);

describe('registrationAvailability', () => {
  it('is open before the event', () => {
    expect(registrationAvailability({ scheduledAt: start, durationMinutes: 60 }, at(-1440))).toEqual({ open: true });
  });
  it('stays open through the event and the late-join grace', () => {
    expect(registrationAvailability({ scheduledAt: start, durationMinutes: 60 }, at(60 + LATE_JOIN_GRACE_MIN))).toEqual({ open: true });
  });
  it('closes as "ended" one minute after the grace', () => {
    expect(registrationAvailability({ scheduledAt: start, durationMinutes: 60 }, at(60 + LATE_JOIN_GRACE_MIN + 1))).toEqual({ open: false, reason: 'ended' });
  });
  it('defaults the duration to 60 minutes when unknown', () => {
    expect(registrationAvailability({ scheduledAt: start }, at(76)).open).toBe(false);
    expect(registrationAvailability({ scheduledAt: start }, at(75)).open).toBe(true);
  });
  it('a webinar with no scheduled time never "ends"', () => {
    expect(registrationAvailability({ scheduledAt: null }, at(100000))).toEqual({ open: true });
  });
  it('archived and completed webinars are closed regardless of the clock', () => {
    expect(registrationAvailability({ archived: true, scheduledAt: start }, at(-10))).toEqual({ open: false, reason: 'archived' });
    expect(registrationAvailability({ status: 'completed' }, at(-10))).toEqual({ open: false, reason: 'completed' });
  });
  it('closes as "full" at capacity, not before', () => {
    expect(registrationAvailability({ capacity: 150, registrations: 149 }, at(-10))).toEqual({ open: true });
    expect(registrationAvailability({ capacity: 150, registrations: 150 }, at(-10))).toEqual({ open: false, reason: 'full' });
    expect(registrationAvailability({ capacity: 150, registrations: 400 }, at(-10))).toEqual({ open: false, reason: 'full' });
  });
  it('treats missing, zero or negative capacity as unlimited', () => {
    for (const capacity of [null, undefined, 0, -5]) expect(registrationAvailability({ capacity, registrations: 999 }, at(-10))).toEqual({ open: true });
  });
  it('"ended" outranks "full" (the more useful message)', () => {
    expect(registrationAvailability({ scheduledAt: start, capacity: 1, registrations: 1 }, at(500))).toEqual({ open: false, reason: 'ended' });
  });
});
