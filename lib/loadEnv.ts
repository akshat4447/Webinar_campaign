// Side-effect-only module: every standalone script (scripts/*.ts, prisma/seed.ts)
// must `import './loadEnv'` (relative path) as its FIRST import, before anything
// that transitively reaches lib/db.ts.
//
// Why this has to be its own module rather than `import { loadEnvConfig } from
// '@next/env'; loadEnvConfig(process.cwd());` inline: tsx hoists static imports
// ahead of other top-level statements in the same file, so that inline call ran
// AFTER a later `import { db } from './db'` had already evaluated — silently
// masked for years by SQLite's env-optional fallback, surfaced the moment
// DATABASE_URL became required for Postgres. Doing the loadEnvConfig() call
// inside a dedicated module's own top-level code sidesteps the hoisting
// entirely: requiring this module runs it to completion (env vars loaded)
// before the importing file's next import is even reached.
//
// Plain `dotenv/config` only reads `.env`, never `.env.local` — real secrets
// live in `.env.local`, so this needs Next's own loader specifically.
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
