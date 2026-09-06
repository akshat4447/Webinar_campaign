import { PrismaClient } from './generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Standard Next.js dev-mode singleton: avoids exhausting SQLite connections
// across hot-reloads by reusing one client on the global object.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// @ts-expect-error better-sqlite3 does not bundle typescript definitions
import Database from 'better-sqlite3';

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  const dbPath = url.replace(/^file:/, '');
  try {
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
