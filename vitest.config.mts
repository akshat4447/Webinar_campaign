import { defineConfig } from 'vitest/config';
import path from 'path';
// @next/env is CommonJS — under this file's native-ESM loader (Vite's config
// loader, not tsx) a named import doesn't get the interop shim, so pull the
// default export and destructure instead.
import nextEnv from '@next/env';

// A couple of test files import modules that reach lib/db.ts at import time
// (its Prisma client is created eagerly, module-level) — without this, those
// suites fail with "DATABASE_URL is not set" since vitest doesn't load
// .env/.env.local on its own the way Next's own dev/build/start commands do.
nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './'),
    },
  },
});
