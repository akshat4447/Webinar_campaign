// Server-only. A small idempotency / de-duplication ledger for outbound side
// effects (LeadSquared activities, Zoom registrants) and inbound webhook events.
//
// Backed by the existing AppSetting key/value table on purpose: the unique
// primary key gives an atomic "first writer wins" claim without a schema
// migration. Each row is `idem:<key>` -> ISO timestamp of the claim. A claim
// older than its TTL is treated as expired and can be re-claimed with a
// compare-and-swap, so a crashed worker cannot block a key forever.
//
// If this ledger ever needs queries beyond claim/release, move it to a dedicated
// model — the exported API (claimOnce / release / purgeExpired / idemKey) is the
// only surface callers depend on.

import { createHash } from 'node:crypto';
import { db } from '@/lib/db';

const PREFIX = 'idem:';
export const DEFAULT_IDEM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Stable, bounded-length key from arbitrary parts (never leaks PII into the table). */
export function idemKey(namespace: string, ...parts: Array<string | number | null | undefined>): string {
  const digest = createHash('sha256')
    .update(parts.map((p) => String(p ?? '')).join('␟'))
    .digest('hex')
    .slice(0, 40);
  return `${namespace}:${digest}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Atomically claim `key`. Returns true when THIS caller now owns the claim and
 * should perform the side effect; false when someone already did (or is doing) it.
 */
export async function claimOnce(key: string, ttlMs: number = DEFAULT_IDEM_TTL_MS): Promise<boolean> {
  const rowKey = `${PREFIX}${key}`;
  const nowIso = new Date().toISOString();
  try {
    await db.appSetting.create({ data: { key: rowKey, value: nowIso } });
    return true;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await db.appSetting.findUnique({ where: { key: rowKey } });
  if (!existing) return claimOnce(key, ttlMs); // released between our two calls
  const claimedAt = Date.parse(existing.value);
  if (Number.isFinite(claimedAt) && Date.now() - claimedAt < ttlMs) return false;

  // Expired: compare-and-swap on the old value so exactly one racer wins.
  const swapped = await db.appSetting.updateMany({ where: { key: rowKey, value: existing.value }, data: { value: nowIso } });
  return swapped.count === 1;
}

/** Give a claim back (call when the guarded side effect FAILED so a retry may run it). */
export async function release(key: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: `${PREFIX}${key}` } });
}

/** Delete claims older than `ttlMs`. Safe to call opportunistically. */
export async function purgeExpired(ttlMs: number = DEFAULT_IDEM_TTL_MS): Promise<number> {
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  // ISO-8601 timestamps sort lexicographically, so a string comparison is a time comparison.
  const res = await db.appSetting.deleteMany({ where: { key: { startsWith: PREFIX }, value: { lt: cutoff } } });
  return res.count;
}

/** Which of `keys` are currently claimed (live or expired — callers only need "was it ever done"). */
export async function findClaimed(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.appSetting.findMany({ where: { key: { in: keys.map((k) => `${PREFIX}${k}`) } }, select: { key: true } });
  return new Set(rows.map((r) => r.key.slice(PREFIX.length)));
}
