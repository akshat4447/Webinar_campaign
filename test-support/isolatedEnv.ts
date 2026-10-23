import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Disposable servers never inherit real credentials or provider URLs from dotenv or the parent shell. */
export function isolatedServerEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const file of readdirSync(process.cwd()).filter(name => /^\.env(?:\.|$)/.test(name))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = '';
    }
  }
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|APOLLO_|LSQ_|NETCORE_|ZOOM_|LINKEDIN_)/.test(key)) env[key] = '';
  const preload = resolve('test-support/local-network-only.cjs');
  return {
    ...env,
    CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false',
    ...overrides,
    TEST_NETWORK_ISOLATION: 'local-only',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`.trim(),
  };
}
