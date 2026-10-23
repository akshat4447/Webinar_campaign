import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('scripts/start-server.cjs'), 'utf8');

function start(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    DATABASE_URL: 'postgresql://test@localhost/test',
    APP_USERNAME: 'test-operator', APP_PASSWORD: 'test-only-password',
    REGISTRATION_SECRET: 'test-signing-key-with-at-least-32-characters',
    CREDENTIALS_ENCRYPTION_KEY: 'test-encryption-key-with-at-least-32-characters',
    ...overrides,
  };
  const boot = vi.fn();
  runInNewContext(source, {
    process: { env, cwd: () => process.cwd() },
    URL,
    require: (name: string) => {
      if (name === '@next/env') return { loadEnvConfig: () => {} };
      if (name === 'node:path') return { resolve };
      if (name === 'node:fs') return { existsSync: () => true };
      if (name === resolve('.next/standalone/server.js')) { boot(env); return {}; }
      throw new Error('Unexpected startup dependency');
    },
  });
  return { env, boot };
}

describe('production startup', () => {
  it('binds Render public ingress even when the platform injects its container hostname', () => {
    const result = start({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://webinar-studio.onrender.com', HOSTNAME: 'srv-container-private-name' });
    expect(result.env.HOSTNAME).toBe('0.0.0.0');
    expect(result.boot).toHaveBeenCalledOnce();
  });
  it('preserves an explicit local test interface', () => {
    expect(start({ HOSTNAME: '127.0.0.1' }).env.HOSTNAME).toBe('127.0.0.1');
  });
  it('defaults to all interfaces when no hostname is configured', () => {
    expect(start().env.HOSTNAME).toBe('0.0.0.0');
  });
  it('refuses missing operator credentials before loading the server', () => {
    expect(() => start({ APP_PASSWORD: undefined })).toThrow('APP_PASSWORD is missing');
  });
  it('refuses shared signing/encryption keys', () => {
    expect(() => start({ CREDENTIALS_ENCRYPTION_KEY: 'test-signing-key-with-at-least-32-characters' })).toThrow('keys must be independent');
  });
  it('refuses a non-HTTPS Render origin', () => {
    expect(() => start({ RENDER: 'true', RENDER_EXTERNAL_URL: 'http://webinar-studio.onrender.com' })).toThrow('public HTTPS');
  });
});
