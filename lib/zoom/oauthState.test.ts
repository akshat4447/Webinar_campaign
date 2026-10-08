import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@/lib/db', () => ({
  db: {
    appSetting: {
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => void store.set(where.key, create.value)),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null)),
      findMany: vi.fn(async ({ where }: { where: { key: { startsWith: string } } }) => [...store].filter(([k]) => k.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value }))),
      deleteMany: vi.fn(async ({ where }: { where: { key: string | { in: string[] } } }) => {
        const keys = typeof where.key === 'string' ? [where.key] : where.key.in;
        let count = 0;
        for (const k of keys) if (store.delete(k)) count++;
        return { count };
      }),
    },
  },
}));

import { oauthStateKey, purgeExpiredOAuthStates, readStateCookie, storeOAuthState, validateAndConsumeOAuthState, OAUTH_STATE_TTL_MS } from './oauthState';

const NOW = 1_800_000_000_000;
beforeEach(() => store.clear());

describe('readStateCookie', () => {
  it('extracts the state even when other cookies are present, and keeps "=" inside the value', () => {
    expect(readStateCookie('a=1; zoom_oauth_state=abc-123; b=2')).toBe('abc-123');
    expect(readStateCookie('zoom_oauth_state=a=b')).toBe('a=b');
    expect(readStateCookie('a=1')).toBeUndefined();
    expect(readStateCookie(null)).toBeUndefined();
  });
});

describe('validateAndConsumeOAuthState', () => {
  it('accepts a matching cookie and consumes the server-side record (no replay)', async () => {
    await storeOAuthState('s1', NOW);
    expect(await validateAndConsumeOAuthState('zoom_oauth_state=s1', 's1', NOW)).toBe(true);
    expect(store.has(oauthStateKey('s1'))).toBe(false);
    expect(await validateAndConsumeOAuthState(null, 's1', NOW)).toBe(false); // replay via the DB path fails
  });

  it('rejects a mismatching cookie EVEN IF the server-side record is valid (login-CSRF)', async () => {
    await storeOAuthState('attacker-state', NOW);
    expect(await validateAndConsumeOAuthState('zoom_oauth_state=victim-own', 'attacker-state', NOW)).toBe(false);
    expect(store.has(oauthStateKey('attacker-state'))).toBe(false); // and it is burned
  });

  it('falls back to the server-side record only when the browser sent no cookie', async () => {
    await storeOAuthState('s2', NOW);
    expect(await validateAndConsumeOAuthState(null, 's2', NOW + 1000)).toBe(true);
  });

  it('rejects an expired or unknown server-side record, and a missing state', async () => {
    await storeOAuthState('s3', NOW);
    expect(await validateAndConsumeOAuthState(null, 's3', NOW + OAUTH_STATE_TTL_MS + 1)).toBe(false);
    expect(await validateAndConsumeOAuthState(null, 'never-issued', NOW)).toBe(false);
    expect(await validateAndConsumeOAuthState('zoom_oauth_state=x', null, NOW)).toBe(false);
  });
});

describe('purgeExpiredOAuthStates', () => {
  it('removes only expired oauth states', async () => {
    await storeOAuthState('old', NOW - OAUTH_STATE_TTL_MS - 5000);
    await storeOAuthState('fresh', NOW);
    store.set('integration.zoom.mode', 'live');
    expect(await purgeExpiredOAuthStates(NOW)).toBe(1);
    expect([...store.keys()].sort()).toEqual(['integration.zoom.mode', oauthStateKey('fresh')]);
  });
});
