import { db } from '@/lib/db';
import { requestOrigin } from '@/lib/requestOrigin';
import { safeReturnTo } from '@/lib/wizardDraft';

// "Where to send the person after a provider connection", remembered on the server next to the OAuth state.
//
// The destination is chosen when the connect flow starts and validated then (safeReturnTo accepts only two
// same-site shapes). It is stored under the same one-time state the provider echoes back, so it travels
// server-side: nothing in the redirect URL can alter it, and it expires with the state.

export type OAuthProvider = 'zoom' | 'linkedin';

export const OAUTH_RETURN_TTL_MS = 10 * 60 * 1000;
const key = (provider: OAuthProvider, state: string) => `${provider}.oauth_return.${state}`;

export async function storeOAuthReturn(provider: OAuthProvider, state: string, rawReturnTo: unknown, nowMs: number = Date.now()): Promise<void> {
  const returnTo = safeReturnTo(rawReturnTo);
  if (!returnTo) return;
  const value = JSON.stringify({ returnTo, exp: nowMs + OAUTH_RETURN_TTL_MS });
  await db.appSetting.upsert({ where: { key: key(provider, state) }, create: { key: key(provider, state), value }, update: { value } });
}

/** Reads the stored destination (re-validating it) and deletes it: one use per state. */
export async function takeOAuthReturn(provider: OAuthProvider, state: string | null, nowMs: number = Date.now()): Promise<string | null> {
  if (!state) return null;
  const k = key(provider, state);
  try {
    const row = await db.appSetting.findUnique({ where: { key: k } });
    await db.appSetting.deleteMany({ where: { key: k } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as { returnTo?: unknown; exp?: unknown };
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowMs) return null;
    return safeReturnTo(parsed.returnTo);
  } catch {
    return null;
  }
}

/** Housekeeping: drop destinations whose connection was never completed. */
export async function purgeExpiredOAuthReturns(nowMs: number = Date.now()): Promise<number> {
  let removed = 0;
  for (const provider of ['zoom', 'linkedin'] as const) {
    const rows = await db.appSetting.findMany({ where: { key: { startsWith: `${provider}.oauth_return.` } } });
    const expired = rows.filter((r) => {
      try {
        return !((JSON.parse(r.value) as { exp?: number }).exp! > nowMs);
      } catch {
        return true;
      }
    });
    if (expired.length) removed += (await db.appSetting.deleteMany({ where: { key: { in: expired.map((r) => r.key) } } })).count;
  }
  return removed;
}

/**
 * The redirect an OAuth callback ends with. A successful connection goes back to the page that started it;
 * a failed one stays on Integrations (with the way back kept), so the person can fix the setting and retry.
 */
export function oauthRedirect(request: Request, opts: { params: Record<string, string>; returnTo: string | null; ok: boolean }): Response {
  const origin = requestOrigin(request);
  const toReturn = opts.ok && opts.returnTo;
  const url = new URL(toReturn ? (opts.returnTo as string) : '/integrations', origin);
  for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
  if (!toReturn && opts.returnTo) url.searchParams.set('returnTo', opts.returnTo);
  return Response.redirect(url.toString(), 302);
}
