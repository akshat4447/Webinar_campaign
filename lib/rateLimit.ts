// Server-only. Fixed-window rate limiting built on the idempotency ledger.
//
// Each window has `limit` numbered slots; a request must atomically claim one
// (first-writer-wins, see lib/idempotency.ts), so the limit holds across
// concurrent requests and across server instances — no in-process counter that
// resets on deploy or is bypassed by a second replica.
//
// Fails OPEN: if the ledger itself is unavailable the request is allowed and the
// failure is logged. Rate limiting is abuse mitigation, not a correctness
// guarantee, and a database blip must not take the registration form down.

import { claimOnce, idemKey } from '@/lib/idempotency';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends (for Retry-After). */
  retryAfterSec: number;
}

export async function allowRequest(opts: { scope: string; key: string; limit: number; windowMs: number; nowMs?: number }): Promise<RateLimitResult> {
  const now = opts.nowMs ?? Date.now();
  const bucket = Math.floor(now / opts.windowMs);
  const retryAfterSec = Math.max(1, Math.ceil(((bucket + 1) * opts.windowMs - now) / 1000));
  try {
    for (let slot = 0; slot < opts.limit; slot++) {
      if (await claimOnce(idemKey('rl', opts.scope, opts.key, bucket, slot), opts.windowMs * 2)) return { allowed: true, retryAfterSec };
    }
    return { allowed: false, retryAfterSec };
  } catch (err) {
    console.warn('[rateLimit] ledger unavailable, allowing request:', err instanceof Error ? err.message : err);
    return { allowed: true, retryAfterSec };
  }
}

/** Best-effort client IP from the proxy headers (Render / Vercel / Netlify set x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64) || 'unknown';
  return headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}
