import { PrismaClient } from './generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Standard Next.js dev-mode singleton: avoids exhausting SQLite connections
// across hot-reloads by reusing one client on the global object.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  const dbPath = url.replace(/^file:/, '');
  try {
    // require(), not a static top-level `import` — this file is server-only,
    // but a static import of better-sqlite3's native binding here made
    // Turbopack's dev-mode client-bundle analysis try (and fail) to resolve
    // it for every 'use server' action file that imports `db`, even though
    // it never actually reaches a real client bundle (confirmed via
    // `next build`, which was clean either way). require() keeps this
    // out of static import-graph analysis entirely.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const rawDb = new Database(dbPath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    rawDb.close();
  } catch {
    /* ignore fallback if db is locked or in-memory */
  }

  const adapter = new PrismaBetterSqlite3({
    url,
    timeout: 5000,
  });
  const client = new PrismaClient({ adapter });
  client.$executeRawUnsafe('PRAGMA foreign_keys = ON;').catch(() => {});
  return client;
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
