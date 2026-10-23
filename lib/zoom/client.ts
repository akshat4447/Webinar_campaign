import { resolveIntegrationField, saveIntegrationConfig } from '@/lib/integrationConfig';
import { ZOOM_API_BASE_URL, ZOOM_TOKEN_URL } from './auth';
import { retryDelayMs, sleep } from '@/lib/retry';


export const ZOOM_API_BASE = ZOOM_API_BASE_URL;

export class ZoomError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Zoom's own numeric error code from the response body (e.g. 3027 = registration not enabled). */
    readonly code?: number
  ) {
    super(message);
    this.name = 'ZoomError';
  }
}

/** The scope names in Zoom's "does not contain scopes:[a,b]" message, if it names any. */
export function missingScopesIn(message: string): string[] {
  const m = /scopes:\s*\[([^\]]+)\]/i.exec(message);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
}

/** Pulls Zoom's `{ code, message }` out of an error body, tolerating non-JSON. */
export function parseZoomErrorBody(raw: string): { code?: number; message?: string } {
  try {
    const j = JSON.parse(raw) as { code?: unknown; message?: unknown };
    return { code: typeof j.code === 'number' ? j.code : undefined, message: typeof j.message === 'string' ? j.message : undefined };
  } catch {
    return {};
  }
}

/**
 * The user segment for `/users/{…}/meetings`.
 *  - User-managed OAuth: Zoom resolves the literal `me` to whoever connected.
 *  - Server-to-Server OAuth: there is no "current user", `me` is rejected — a host user id or
 *    email must be named explicitly (Integrations → Zoom → Host email / ZOOM_HOST_EMAIL).
 */
export async function zoomHostUser(): Promise<string> {
  const { accountId } = await storedRefreshCredentials();
  if (!accountId) return 'me';
  const host = ((await resolveIntegrationField('zoom', 'hostEmail')) || process.env.ZOOM_HOST_EMAIL || '').trim();
  if (!host) {
    throw new ZoomError(
      'Zoom Server-to-Server OAuth needs a host user: set the Host email on Integrations → Zoom (or ZOOM_HOST_EMAIL). Server-to-Server apps cannot use "me".'
    );
  }
  return encodeURIComponent(host);
}

async function storedAccessToken(): Promise<string | undefined> {
  return (await resolveIntegrationField('zoom', 'accessToken')) || undefined;
}

async function storedRefreshCredentials(): Promise<{ accountId?: string; clientId?: string; clientSecret?: string; refreshToken?: string }> {
  return {
    accountId: await resolveIntegrationField('zoom', 'accountId'),
    clientId: (await resolveIntegrationField('zoom', 'clientId')) || process.env.ZOOM_CLIENT_ID,
    clientSecret: (await resolveIntegrationField('zoom', 'clientSecret')) || process.env.ZOOM_CLIENT_SECRET,
    refreshToken: await resolveIntegrationField('zoom', 'refreshToken'),
  };
}


export async function zoomIsConfigured(): Promise<boolean> {
  const token = await storedAccessToken();
  if (token) return true;
  const { accountId, clientId, clientSecret } = await storedRefreshCredentials();
  return !!(accountId && clientId && clientSecret);
}

/**
 * Null when Zoom is genuinely connected — an account has completed OAuth
 * *and* live mode is active so the connection is actually in effect.
 */
export async function zoomConnectionError(): Promise<string | null> {
  if (!(await zoomIsConfigured())) {
    return "Zoom isn't connected — click \"Connect with Zoom\" or provide an Account ID for Server-to-Server OAuth on Integrations → Zoom.";
  }
  return null;
}

// Single-flight refresh: concurrent callers share ONE in-flight refresh instead of
// each burning a (rotating) refresh token. The slot is cleared by `.finally` on
// the wrapper below, so EVERY exit path of the refresh — Server-to-Server
// success, early "no credentials" returns, errors — frees it. (It used to be
// cleared only inside the User-OAuth branch, so after the first Server-to-Server
// refresh the stale promise was returned forever and the token never renewed.)
let activeRefreshPromise: Promise<RefreshResult> | null = null;

/** Refresh this far ahead of the recorded expiry so a token is never used in its last seconds. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;

export type RefreshResult = { ok: true; accessToken: string } | { ok: false; error: string };

/**
 * What a refused token renewal means, in words that say what to do. Zoom answers `invalid_grant` or "Invalid
 * Token" for a refresh token it will no longer accept: revoked, replaced by a newer authorization of the same
 * app, or unused for too long. That cannot be fixed by retrying, only by authorizing again.
 */
export function describeTokenRenewalFailure(status: number, body: { error?: string; reason?: string; error_description?: string }): string {
  const code = `${body.error ?? ''} ${body.reason ?? ''} ${body.error_description ?? ''}`.toLowerCase();
  if (/invalid_client|invalid client/.test(code)) {
    return `Zoom rejected the Client ID or Client Secret saved here (HTTP ${status}). They do not match the Zoom app, or the secret was regenerated. Copy them again from the app's App Credentials page.`;
  }
  if (/invalid_grant|invalid token|invalid_request|expired|revoked/.test(code) || status === 400) {
    return `Zoom no longer accepts the saved connection (${(body.reason || body.error || `HTTP ${status}`).toString().slice(0, 80)}). It was revoked, replaced by a newer authorization of the same app, or unused for too long. Click "Connect With Zoom" to authorize again.`;
  }
  return `Zoom would not renew the saved connection (HTTP ${status}${body.reason ? `: ${body.reason}` : ''}). Try again, or click "Connect With Zoom" to authorize again.`;
}

/** One best-effort refresh. Supports both Server-to-Server OAuth (Account ID) and User OAuth (refresh token). */
function tryRefreshAccessToken(): Promise<string | undefined> {
  return renewZoomConnection().then((r) => (r.ok ? r.accessToken : undefined));
}

/** Renews the saved connection and says why when it cannot be renewed (used by Test Connection). */
export function renewZoomConnection(): Promise<RefreshResult> {
  if (!activeRefreshPromise) {
    activeRefreshPromise = refreshAccessTokenOnce().finally(() => {
      activeRefreshPromise = null;
    });
  }
  return activeRefreshPromise;
}

async function refreshAccessTokenOnce(): Promise<RefreshResult> {
  const { accountId, clientId, clientSecret, refreshToken } = await storedRefreshCredentials();
  if (!clientId || !clientSecret) return { ok: false, error: 'The Zoom Client ID and Client Secret are not saved.' };

  // Server-to-Server OAuth takes precedence if accountId is present
  if (accountId) {
    try {
      const { getServerToServerToken } = await import('./auth');
      const tokenRes = await getServerToServerToken({ accountId, clientId, clientSecret });
      await saveIntegrationConfig('zoom', {
        accessToken: tokenRes.accessToken,
        ...(tokenRes.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + tokenRes.expiresInSec * 1000).toISOString() } : {}),
      });
      return { ok: true, accessToken: tokenRes.accessToken };
    } catch (err) {
      console.error('[zoom/client] Server-to-Server token fetch failed:', err);
      return { ok: false, error: `Zoom would not issue a Server-to-Server token: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` };
    }
  }

  if (!refreshToken) return { ok: false, error: 'No refresh token is saved, so the connection cannot be renewed. Click "Connect With Zoom" to authorize.' };
  try {
    const res = await fetch(ZOOM_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; reason?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const error = describeTokenRenewalFailure(res.status, body);
      console.warn('[zoom/client] token renewal refused:', error);
      return { ok: false, error };
    }
    await saveIntegrationConfig('zoom', {
      accessToken: body.access_token,
      // Zoom rotates the refresh token on every use — the old one stops
      // working, so failing to save the new one would strand the connection
      // after exactly one silent refresh.
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      ...(body.expires_in ? { tokenExpiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() } : {}),
    });
    return { ok: true, accessToken: body.access_token };
  } catch (err) {
    return { ok: false, error: `Zoom could not be reached to renew the connection: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` };
  }
}

/**
 * The token to use right now. Refreshes ahead of the recorded expiry (cached
 * tokens carry a TTL), and bootstraps a first token for Server-to-Server apps
 * that have credentials but have never fetched one.
 */
async function currentAccessToken(): Promise<string | undefined> {
  const token = await storedAccessToken();
  const expiresAt = Date.parse((await resolveIntegrationField('zoom', 'tokenExpiresAt')) ?? '');
  const expiringSoon = Number.isFinite(expiresAt) && expiresAt - Date.now() < TOKEN_EXPIRY_SKEW_MS;
  if (token && !expiringSoon) return token;
  if (!token && !(await zoomIsConfigured())) return undefined;
  const renewed = await renewZoomConnection();
  if (renewed.ok) return renewed.accessToken;
  // A temporary renewal failure can still use a token during its final valid seconds. An expired token
  // cannot succeed: preserve the actionable reconnect/credential error instead of refreshing it twice.
  if (token && expiresAt > Date.now()) return token;
  throw new ZoomError(renewed.error, 401);
}

/**
 * Single choke point for all Zoom API calls.
 *  - 401: refresh once (unless another caller already rotated the token) and retry.
 *  - 429: always retried — Zoom rejected it unprocessed — honouring Retry-After.
 *  - 5xx / network errors: retried only for GET, because a POST may have been
 *    processed before the failure and a blind replay could double-apply it.
 * Backoff is exponential with full jitter; every request has a timeout.
 */
export async function zoomRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initialToken = await currentAccessToken();
  if (!initialToken) throw new ZoomError('Zoom is not connected — connect it on the Integrations page first.');
  let token: string = initialToken;

  const method = (init.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET';

  const send = (t: string) =>
    fetch(`${ZOOM_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let refreshedOnce = false;
  let rescopedOnce = false;
  let res: Response | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      res = await send(token);
    } catch (err) {
      if (isRead && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw new ZoomError(`Zoom ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.status === 401 && !refreshedOnce) {
      refreshedOnce = true;
      // If another caller already rotated the stored token, just use it.
      const stored = await storedAccessToken();
      let next = stored && stored !== token ? stored : undefined;
      if (!next) {
        const renewed = await renewZoomConnection();
        if (!renewed.ok) {
          await res.body?.cancel();
          throw new ZoomError(renewed.error, 401);
        }
        next = renewed.accessToken;
      }
      if (next) {
        await res.body?.cancel();
        token = next;
        attempt--; // the refresh retry does not consume a backoff attempt
        continue;
      }
      break;
    }

    // A Server-to-Server token is cached for up to an hour with the scopes it was issued with. Adding scopes to
    // the Marketplace app does nothing for that token, so a "missing scopes" answer gets one fresh token, which
    // is what makes newly added scopes take effect without waiting out the hour.
    if (res.status === 400 && !rescopedOnce) {
      const body = await res.clone().text();
      if (/does not contain scopes/i.test(body) && (await storedRefreshCredentials()).accountId) {
        rescopedOnce = true;
        const fresh = await tryRefreshAccessToken();
        if (fresh && fresh !== token) {
          token = fresh;
          attempt--;
          continue;
        }
      }
    }

    const retryable = res.status === 429 || (res.status >= 500 && isRead);
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      await sleep(retryDelayMs(attempt, res.headers.get('retry-after')));
      continue;
    }
    break;
  }

  if (!res) throw new ZoomError(`Zoom ${method} ${path} failed: no response`);
  if (!res.ok) {
    const raw = await res.text();
    const parsed = parseZoomErrorBody(raw);
    let msg = `Zoom ${method} ${path} failed: ${res.status} ${raw}`;
    if (raw.includes('does not contain scopes')) {
      const scopes = missingScopesIn(parsed.message ?? raw);
      const named = scopes.length ? ` Zoom names: ${scopes.join(', ')}.` : '';
      const serverToServer = Boolean((await storedRefreshCredentials()).accountId);
      msg += serverToServer
        ? ` — Missing permissions.${named} Add them to the Server-to-Server app in the Zoom Marketplace (scopes of an account-level app end in ":admin"), then try again; no reconnect is needed.`
        : ` — Missing permissions.${named} Add them to the app in the Zoom Marketplace, then click "Connect with Zoom" again in Integrations to grant them.`;
    }
    throw new ZoomError(msg, res.status, parsed.code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
