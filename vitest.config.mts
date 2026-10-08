import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { fileParallelism: !process.env.TEST_DATABASE_URL, setupFiles: ['./test-support/setup.ts'], exclude: ['node_modules/**', '.next*/**', ...(process.env.TEST_DATABASE_URL ? [] : ['test-support/integration/**'])] },
});
