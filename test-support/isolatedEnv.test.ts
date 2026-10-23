import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { isolatedServerEnv } from './isolatedEnv';

describe('disposable server isolation', () => {
  it('removes inherited provider credentials and keeps only deliberate fake overrides', () => {
    vi.stubEnv('LSQ_ACCESS_KEY', 'real-value-must-never-survive');
    vi.stubEnv('ZOOM_API_BASE_URL', 'https://real-provider.example');
    const env = isolatedServerEnv({ APOLLO_API_KEY: 'fake-key', APOLLO_API_BASE_URL: 'http://127.0.0.1:9876' });
    expect(env.LSQ_ACCESS_KEY).toBe('');
    expect(env.ZOOM_API_BASE_URL).toBe('');
    expect(env.APOLLO_API_KEY).toBe('fake-key');
    expect(env.TEST_NETWORK_ISOLATION).toBe('local-only');
  });
  it('blocks a server-side socket before connecting to a public IP, including TLS/undici callers', () => {
    const result = spawnSync(process.execPath, ['-e', "require('node:net').connect({host:'203.0.113.1',port:443})"], { env: isolatedServerEnv({}), encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Test network isolation refused non-local connection');
  });
});
