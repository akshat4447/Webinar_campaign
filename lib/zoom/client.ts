import { resolveIntegrationField, saveIntegrationConfig } from '@/lib/integrationConfig';
import { ZOOM_TOKEN_URL } from './auth';

// User-managed OAuth — the operator connects their own Zoom account via a
// browser consent screen on Integrations (mirrors lib/linkedin/client.ts),
// the same shape a real Zoom Marketplace app (e.g. one published by
// LeadSquared) uses. There is no shared account-level credential here: every
// call acts as whichever Zoom account was connected.
//
// A sandbox mode that simulates every call, so the whole flow is exercisable
// without a real connection, and a live mode that makes real requests. The
// switch is explicit rather than "live if a token happens to be present",
// because silently going live is how test data reaches real people.

export const ZOOM_API_BASE = 'https://api.zoom.us/v2';

export function zoomMode(): 'sandbox' | 'live' {
  return process.env.ZOOM_MODE === 'live' ? 'live' : 'sandbox';
}

export class ZoomError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ZoomError';
  }
}

async function storedAccessToken(): Promise<string | undefined> {
  return (await resolveIntegrationField('zoom', 'accessToken')) || undefined;
}

async function storedRefreshCredentials(): Promise<{ clientId?: string; clientSecret?: string; refreshToken?: string }> {
  return {
    clientId: (await resolveIntegrationField('zoom', 'clientId')) || process.env.ZOOM_CLIENT_ID,
    clientSecret: (await resolveIntegrationField('zoom', 'clientSecret')) || process.env.ZOOM_CLIENT_SECRET,
    refreshToken: await resolveIntegrationField('zoom', 'refreshToken'),
  };
}

/** True once a Zoom account has actually been connected (Connect completed
 *  and an access token is on file) — independent of live/sandbox mode. */
export async function zoomIsConfigured(): Promise<boolean> {
  return !!(await storedAccessToken());
}

/**
 * Null when Zoom is genuinely connected — an account has completed OAuth
 * *and* `ZOOM_MODE=live` so the connection is actually in effect. Anything
 * else returns a message naming exactly what's missing, for a feature
 * (fetching a real event's details) where a sandbox fixture standing in for
 * a real meeting would be actively misleading rather than merely a fallback.
 */
export async function zoomConnectionError(): Promise<string | null> {
  if (!(await zoomIsConfigured())) {
    return "Zoom isn't connected — click \"Connect with Zoom\" on Integrations → Zoom.";
  }
  if (zoomMode() !== 'live') {
    return 'Zoom is connected but the connection is still in sandbox mode — set ZOOM_MODE=live to fetch real events.';
  }
  return null;
}

/** One best-effort refresh; returns the new token or gives up quietly. */
async function tryRefreshAccessToken(): Promise<string | undefined> {
  const { clientId, clientSecret, refreshToken } = await storedRefreshCredentials();
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  try {
    const res = await fetch(ZOOM_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      cache: 'no-store',
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
 * Single choke point for all Zoom API calls. On 401 it tries one token
 * refresh + retry (access tokens last an hour), so callers never deal with
 * expiry mid-flow.
 */
export async function zoomRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await storedAccessToken();
  if (!token) throw new ZoomError('Zoom is not connected — connect it on the Integrations page first.');

  const send = (t: string) =>
    fetch(`${ZOOM_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
    });

  let res = await send(token);
  if (res.status === 401) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      token = refreshed;
      res = await send(token);
    }
  }

  if (!res.ok) throw new ZoomError(`Zoom ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`, res.status);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
