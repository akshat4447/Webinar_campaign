import { describe, it, expect } from 'vitest';
import { fullJitterDelayMs, parseRetryAfterMs, retryDelayMs } from './retry';

describe('fullJitterDelayMs', () => {
  it('is uniform in [0, min(cap, base*2^attempt))', () => {
    expect(fullJitterDelayMs(0, { baseMs: 500, rand: () => 0 })).toBe(0);
    expect(fullJitterDelayMs(2, { baseMs: 500, rand: () => 0.999 })).toBe(1998);
    expect(fullJitterDelayMs(10, { baseMs: 500, capMs: 15_000, rand: () => 0.5 })).toBe(7500);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds and clamps to the cap', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('9999')).toBe(30_000);
  });
  it('parses an HTTP date relative to now and never goes negative', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Oct 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfterMs('Wed, 30 Sep 2026 00:00:00 GMT', now)).toBe(0);
  });
  it('returns null for absent or junk values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('retryDelayMs', () => {
  it('prefers the server hint over backoff', () => {
    expect(retryDelayMs(3, '1', { rand: () => 0.9 })).toBe(1000);
    expect(retryDelayMs(1, null, { baseMs: 100, rand: () => 0.5 })).toBe(100);
  });
});
