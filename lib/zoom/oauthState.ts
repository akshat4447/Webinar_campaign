// Server-only. CSRF "state" handling for the Zoom OAuth round trip.
//
// /connect mints a random state, sets it as an HttpOnly cookie (binding it to
// THIS browser) and also stores it server-side with an expiry, because dev
// tunnels / proxies sometimes drop the cookie between the two redirects.
//
// Rules enforced here:
//  - A state is ONE-TIME: its server-side record is consumed on every attempt,
//    whichever path validated it, so a captured callback URL cannot be replayed.
//  - If the browser sent a state cookie, it MUST match. A mismatching cookie is
//    never rescued by the server-side record — that rescue exists only for the
//    cookie-less case, and allowing it here would let an attacker who started
//    their own flow (valid server-side state) feed a victim a callback link.

import { db } from '@/lib/db';

const KEY_PREFIX = 'zoom.oauth_state.';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const oauthStateKey = (state: string) => `${KEY_PREFIX}${state}`;

export function readStateCookie(cookieHeader: string | null): string | undefined {
  return (cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('zoom_oauth_state='))
    ?.slice('zoom_oauth_state='.length);
}

export async function storeOAuthState(state: string, nowMs: number = Date.now()): Promise<void> {
  const key = oauthStateKey(state);
  const value = String(nowMs + OAUTH_STATE_TTL_MS);
  await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function validateAndConsumeOAuthState(cookieHeader: string | null, state: string | null, nowMs: number = Date.now()): Promise<boolean> {
  if (!state) return false;
  const cookieState = readStateCookie(cookieHeader);
  const key = oauthStateKey(state);

  let valid = false;
  try {
    if (cookieState) {
      valid = cookieState === state;
    } else {
      const row = await db.appSetting.findUnique({ where: { key } });
      valid = !!row && Number(row.value) > nowMs;
    }
  } finally {
    // Consume regardless of outcome — never leave a usable state behind.
    await db.appSetting.deleteMany({ where: { key } }).catch(() => undefined);
  }
  return valid;
}

/** Housekeeping: drop abandoned states (the user never came back from Zoom). */
export async function purgeExpiredOAuthStates(nowMs: number = Date.now()): Promise<number> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: KEY_PREFIX } } });
  const expired = rows.filter((r) => !(Number(r.value) > nowMs)).map((r) => r.key);
  if (expired.length === 0) return 0;
  const res = await db.appSetting.deleteMany({ where: { key: { in: expired } } });
  return res.count;
}
