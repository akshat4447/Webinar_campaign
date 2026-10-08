import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
async function main() {
  const base = process.env.TEST_DATABASE_ADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const admin = new Client({ connectionString: base }); await admin.connect();
  const name = `webinar_test_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(base); target.pathname = '/' + name;
  const env = { ...process.env, DATABASE_URL: target.toString(), TEST_DATABASE_URL: target.toString(), CADENCE_AUTOTICK: 'false', ZOOM_AUTOSYNC: 'false' };
  try {
    const migrate = spawnSync('npx', ['prisma','migrate','deploy'], { env, stdio:'inherit' }); if (migrate.status) throw new Error('Test database migrations failed.');
    const diff = spawnSync('npx', ['prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code'], {env,stdio:'inherit'}); if (diff.status) throw new Error('Migrated database differs from schema.');
    const tests = spawnSync('npx', ['vitest','run', 'test-support/integration'], { env, stdio:'inherit' }); process.exitCode = tests.status ?? 1;
  } finally { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end(); }
}
main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode=1; });
