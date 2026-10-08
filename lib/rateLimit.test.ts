import { describe, it, expect, vi, beforeEach } from 'vitest';

const claims = new Set<string>();
const claimOnce = vi.fn(async (k: string) => (claims.has(k) ? false : (claims.add(k), true)));
vi.mock('@/lib/idempotency', () => ({
  idemKey: (ns: string, ...p: unknown[]) => `${ns}:${p.join('|')}`,
  claimOnce: (k: string) => claimOnce(k),
}));

import { allowRequest, clientIp } from './rateLimit';

const base = { scope: 's', key: 'k', limit: 3, windowMs: 60_000, nowMs: 1_000_000 };
beforeEach(() => {
  claims.clear();
  claimOnce.mockClear();
});

describe('allowRequest', () => {
  it('allows exactly `limit` requests per window, then blocks', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await allowRequest(base)).allowed);
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('holds under concurrency (atomic slot claims)', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => allowRequest(base)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('starts a fresh budget in the next window', async () => {
    for (let i = 0; i < 3; i++) await allowRequest(base);
    expect((await allowRequest(base)).allowed).toBe(false);
    expect((await allowRequest({ ...base, nowMs: base.nowMs + 60_000 })).allowed).toBe(true);
  });

  it('isolates different keys and scopes', async () => {
    for (let i = 0; i < 3; i++) await allowRequest(base);
    expect((await allowRequest({ ...base, key: 'other' })).allowed).toBe(true);
    expect((await allowRequest({ ...base, scope: 'other' })).allowed).toBe(true);
  });

  it('reports a sane Retry-After (seconds left in the window, at least 1)', async () => {
    const r = await allowRequest({ ...base, nowMs: 59_500 });
    expect(r.retryAfterSec).toBe(1);
    expect((await allowRequest({ ...base, nowMs: 0 })).retryAfterSec).toBe(60);
  });

  it('fails OPEN when the ledger is unavailable', async () => {
    claimOnce.mockRejectedValueOnce(new Error('db down'));
    expect((await allowRequest(base)).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('uses the first x-forwarded-for hop, then x-real-ip, then unknown', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
