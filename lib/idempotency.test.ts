import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@/lib/db', () => ({
  db: {
    appSetting: {
      create: vi.fn(async ({ data }: { data: { key: string; value: string } }) => {
        if (store.has(data.key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        store.set(data.key, data.value);
      }),
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) => where.key.in.filter((k) => store.has(k)).map((key) => ({ key }))),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null)),
      updateMany: vi.fn(async ({ where, data }: { where: { key: string; value: string }; data: { value: string } }) => {
        if (store.get(where.key) === where.value) {
          store.set(where.key, data.value);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string | { startsWith: string }; value?: { lt: string } } }) => {
        let count = 0;
        for (const [k, v] of [...store]) {
          const keyOk = typeof where.key === 'string' ? k === where.key : k.startsWith(where.key.startsWith);
          const valOk = where.value ? v < where.value.lt : true;
          if (keyOk && valOk) {
            store.delete(k);
            count++;
          }
        }
        return { count };
      }),
    },
  },
}));

import { claimOnce, release, purgeExpired, idemKey } from './idempotency';

beforeEach(() => store.clear());

describe('idempotency ledger', () => {
  it('lets exactly one caller claim a key', async () => {
    expect(await claimOnce('k1')).toBe(true);
    expect(await claimOnce('k1')).toBe(false);
  });

  it('allows a re-claim after release (failed side effect can be retried)', async () => {
    await claimOnce('k2');
    await release('k2');
    expect(await claimOnce('k2')).toBe(true);
  });

  it('allows exactly one winner among concurrent claimers', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => claimOnce('race')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('re-claims an expired claim via compare-and-swap', async () => {
    store.set('idem:old', new Date(Date.now() - 10_000).toISOString());
    expect(await claimOnce('old', 1_000)).toBe(true);
    expect(await claimOnce('old', 1_000)).toBe(false);
  });

  it('purges only expired idem rows', async () => {
    store.set('idem:stale', new Date(Date.now() - 60_000).toISOString());
    store.set('idem:fresh', new Date().toISOString());
    store.set('integration.zoom.mode', 'live');
    expect(await purgeExpired(30_000)).toBe(1);
    expect([...store.keys()].sort()).toEqual(['idem:fresh', 'integration.zoom.mode']);
  });

  it('builds stable, bounded, PII-free keys', () => {
    const a = idemKey('lsq', 'camp', 'a@b.com');
    expect(a).toBe(idemKey('lsq', 'camp', 'a@b.com'));
    expect(a).not.toContain('a@b.com');
    expect(a.length).toBeLessThan(60);
    expect(idemKey('lsq', 'x', 'y')).not.toBe(idemKey('lsq', 'xy', ''));
  });
});

describe('findClaimed', () => {
  it('returns exactly the (unprefixed) keys that have been claimed', async () => {
    const { findClaimed } = await import('./idempotency');
    await claimOnce('a');
    await claimOnce('c');
    expect(await findClaimed(['a', 'b', 'c'])).toEqual(new Set(['a', 'c']));
    expect(await findClaimed([])).toEqual(new Set());
  });
});
