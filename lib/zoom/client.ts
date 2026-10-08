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
let activeRefreshPromise: Promise<string | undefined> | null = null;

/** Refresh this far ahead of the recorded expiry so a token is never used in its last seconds. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;

/** One best-effort refresh; returns the new token or gives up quietly.
 * Supports both Server-to-Server OAuth (using Account ID) and User OAuth (using refresh token).
 */
function tryRefreshAccessToken(): Promise<string | undefined> {
  if (!activeRefreshPromise) {
    activeRefreshPromise = refreshAccessTokenOnce().finally(() => {
      activeRefreshPromise = null;
    });
  }
  return activeRefreshPromise;
}

async function refreshAccessTokenOnce(): Promise<string | undefined> {
  const { accountId, clientId, clientSecret, refreshToken } = await storedRefreshCredentials();
  if (!clientId || !clientSecret) return undefined;

  // Server-to-Server OAuth takes precedence if accountId is present
  if (accountId) {
    try {
      const { getServerToServerToken } = await import('./auth');
      const tokenRes = await getServerToServerToken({ accountId, clientId, clientSecret });
      await saveIntegrationConfig('zoom', {
        accessToken: tokenRes.accessToken,
        ...(tokenRes.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + tokenRes.expiresInSec * 1000).toISOString() } : {}),
      });
      return tokenRes.accessToken;
    } catch (err) {
      console.error('[zoom/client] Server-to-Server token fetch failed:', err);
      return undefined;
    }
  }

  if (!refreshToken) return undefined;
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
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) return undefined;
    await saveIntegrationConfig('zoom', {
      accessToken: body.access_token,
      // Zoom rotates the refresh token on every use — the old one stops
      // working, so failing to save the new one would strand the connection
      // after exactly one silent refresh.
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      ...(body.expires_in ? { tokenExpiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() } : {}),
    });
    return body.access_token;
  } catch {
    return undefined;
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
  return (await tryRefreshAccessToken()) ?? token;
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
      const next: string | undefined = stored && stored !== token ? stored : await tryRefreshAccessToken();
      if (next) {
        token = next;
        attempt--; // the refresh retry does not consume a backoff attempt
        continue;
      }
      break;
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
      msg += ' — Missing permissions. Please ensure the scopes are added in your Zoom Marketplace app, then click "Connect with Zoom" again in Integrations to grant them.';
    }
    throw new ZoomError(msg, res.status, parsed.code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
