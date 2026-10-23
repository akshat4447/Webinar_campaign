import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { createSessionToken } from './auth';

const state = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.unmock('@/lib/operatorSession');
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) }));
import { requireOperatorSession } from './operatorSession';

beforeEach(() => {
  state.token = undefined;
  vi.stubEnv('APP_USERNAME', 'operator');
  vi.stubEnv('APP_PASSWORD', 'isolated-password');
});

it('accepts a valid operator session and rejects absent, forged and expired sessions', async () => {
  await expect(requireOperatorSession()).rejects.toThrow('Sign in required');
  state.token = 'forged';
  await expect(requireOperatorSession()).rejects.toThrow('Sign in required');
  state.token = (await createSessionToken('operator', Date.now() - 8 * 86400000))!;
  await expect(requireOperatorSession()).rejects.toThrow('Sign in required');
  state.token = (await createSessionToken('operator'))!;
  await expect(requireOperatorSession()).resolves.toEqual({ username: 'operator' });
});

describe('all operator actions enforce their own boundary, even without the proxy', () => {
  for (const file of readdirSync(new URL('./actions', import.meta.url)).filter(f => f.endsWith('.ts') && !f.includes('.test.'))) {
    it(`${file}: refuses every exported operation before validating input or accessing the database`, async () => {
      const actions = await import(`./actions/${file.slice(0, -3)}.ts`);
      for (const [name, action] of Object.entries(actions)) {
        if (typeof action !== 'function') continue;
        await expect((action as (...args: unknown[]) => Promise<unknown>)({}), `${file}:${name}`).rejects.toThrow('Sign in required');
      }
    });
  }
});
