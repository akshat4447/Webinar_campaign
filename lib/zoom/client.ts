import { resolveIntegrationField } from '@/lib/integrationConfig';

// Zoom Server-to-Server OAuth. Chosen over user OAuth because this app acts as
// the organisation, not as a signed-in person — there is no user to consent.
//
// Mirrors lib/linkedin/client.ts: a sandbox mode that simulates every call, so
// the whole flow is exercisable without credentials, and a live mode that
// makes real requests. The switch is explicit rather than "live if a key
// happens to be present", because silently going live is how test data reaches
// real people.

export const ZOOM_API_BASE = 'https://api.zoom.us/v2';
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

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

interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

async function credentials(): Promise<ZoomCredentials | null> {
  const [accountId, clientId, clientSecret] = await Promise.all([
    resolveIntegrationField('zoom', 'accountId'),
    resolveIntegrationField('zoom', 'clientId'),
    resolveIntegrationField('zoom', 'clientSecret'),
  ]);
  if (!accountId || !clientId || !clientSecret) return null;
  return { accountId, clientId, clientSecret };
}

/** True when live mode has everything it needs to actually call Zoom. */
export async function zoomIsConfigured(): Promise<boolean> {
  return (await credentials()) !== null;
}

// Access tokens last an hour. Cached in module scope with a safety margin so a
// burst of calls does not mint a token each time.
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const creds = await credentials();
  if (!creds) throw new ZoomError('Zoom is not configured — add the account id, client id and secret on Integrations.');

  const body = new URLSearchParams({ grant_type: 'account_credentials', account_id: creds.accountId });
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new ZoomError(`Zoom token request failed: ${res.status} ${await res.text()}`, res.status);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export async function zoomRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new ZoomError(`Zoom ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`, res.status);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
