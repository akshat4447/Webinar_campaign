// Server-only LinkedIn REST client. Every call goes through restRequest so
// auth headers, version pinning and error normalization happen exactly once.
//
// Version pinning matters more than usual here: LinkedIn sunsets named API
// versions aggressively (202508 died Aug 17 2026), so the header comes from a
// single overridable constant instead of being sprinkled through the code.
import { resolveIntegrationField, saveIntegrationConfig } from '@/lib/integrationConfig';

export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const RESTLI_PROTOCOL_VERSION = '2.0.0';

/** sandbox (default) makes every network path refuse politely — mirrors SEND_MODE. */
export function linkedinMode(): 'sandbox' | 'live' {
  return process.env.LINKEDIN_MODE === 'live' ? 'live' : 'sandbox';
}

export class LinkedInError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`LinkedIn API ${status}: ${body.slice(0, 280)}`);
    this.name = 'LinkedInError';
  }
}

export async function linkedinVersionHeader(): Promise<string> {
  return process.env.LINKEDIN_VERSION || '202608';
}

/** Org URN resolution follows the same DB-then-env rule as every credential. */
export async function resolveOrganizationUrn(): Promise<string | undefined> {
  return (await resolveIntegrationField('linkedin', 'organizationUrn')) || process.env.LINKEDIN_ORGANIZATION_URN || undefined;
}

async function storedAccessToken(): Promise<string | undefined> {
  return (await resolveIntegrationField('linkedin', 'accessToken')) || process.env.LINKEDIN_ACCESS_TOKEN || undefined;
}

async function storedRefreshCredentials(): Promise<{ clientId?: string; clientSecret?: string; refreshToken?: string }> {
  return {
    clientId: (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID,
    clientSecret: (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET,
    refreshToken: await resolveIntegrationField('linkedin', 'refreshToken'),
  };
}

/** One best-effort refresh; returns the new token or gives up quietly. */
async function tryRefreshAccessToken(): Promise<string | undefined> {
  const { clientId, clientSecret, refreshToken } = await storedRefreshCredentials();
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  try {
    const res = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) return undefined;
    await saveIntegrationConfig('linkedin', {
      accessToken: body.access_token,
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      ...(body.expires_in ? { tokenExpiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() } : {}),
    });
    return body.access_token;
  } catch {
    return undefined;
  }
}

export interface RestResult {
  status: number;
  headers: Headers;
  text: string;
  json: unknown | null;
}

function safeParse(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Single choke point for all /rest calls. On 401 it tries one token refresh +
 * retry (LinkedIn member tokens expire every 60 days), so callers never deal
 * with expiry mid-flow.
 */
export async function restRequest(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; absoluteUrl?: string } = {}
): Promise<RestResult> {
  let token = await storedAccessToken();
  if (!token) throw new LinkedInError(401, 'No LinkedIn access token — connect the integration on the Integrations page first.');

  const send = async (t: string) =>
    fetch(opts.absoluteUrl ?? `${LINKEDIN_API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${t}`,
        'LinkedIn-Version': await linkedinVersionHeader(),
        'X-Restli-Protocol-Version': RESTLI_PROTOCOL_VERSION,
        'Content-Type': 'application/json',
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

  const text = await res.text();
  if (!res.ok) throw new LinkedInError(res.status, text);
  return { status: res.status, headers: res.headers, text, json: safeParse(text) };
}

/** Reads whichever id header this endpoint/version returned (they vary). */
export function responseIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-linkedin-id') || headers.get('x-restli-id') || headers.get('x-restli-id'.toLowerCase()) || null;
}