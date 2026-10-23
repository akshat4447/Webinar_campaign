/* eslint-disable @typescript-eslint/no-require-imports -- Node production entry point. */
process.env.NODE_ENV = 'production';
require('@next/env').loadEnvConfig(process.cwd());
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');

for (const key of ['DATABASE_URL', 'APP_USERNAME', 'APP_PASSWORD', 'REGISTRATION_SECRET', 'CREDENTIALS_ENCRYPTION_KEY']) {
  if (!process.env[key]) throw new Error(`Required production setting ${key} is missing.`);
}
for (const key of ['REGISTRATION_SECRET', 'CREDENTIALS_ENCRYPTION_KEY']) {
  if (process.env[key].length < 32) throw new Error(`${key} must have at least 32 characters.`);
}
if (process.env.REGISTRATION_SECRET === process.env.CREDENTIALS_ENCRYPTION_KEY) throw new Error('Signing and encryption keys must be independent.');
if (process.env.RENDER === 'true') {
  const origin = new URL(process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost');
  if (origin.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Render requires a public HTTPS application origin.');
}
const server = resolve(process.env.NEXT_DIST_DIR || '.next', 'standalone/server.js');
if (!existsSync(server)) throw new Error('Production build is missing. Run npm run build first.');
require(server);
