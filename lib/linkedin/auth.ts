// OAuth 2.0 three-legged flow helpers (member authorization → Page-scoped
// tokens). Scope set covers everything this feature touches:
//   r_events / rw_events              — read + create Events & registration forms
//   r_marketing_leadgen_automation    — Lead Sync webhook subscriptions + organic lead reads
//   w_organization_social             — posting the announcement as the Page
//   r_organization_social             — reading organizationAcls during connect
import { LINKEDIN_TOKEN_URL, restRequest } from './client';

export const LINKEDIN_SCOPES = [
  'r_events',
  'rw_events',
  'r_marketing_leadgen_automation',
  'w_organization_social',
  'r_organization_social',
];

export function buildAuthorizationUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', LINKEDIN_SCOPES.join(' '));
  return url.toString();
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenExchangeResult> {
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    throw new Error(`LinkedIn token endpoint ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSec: json.expires_in };
}

export function exchangeCodeForToken(args: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  }));
}

export function refreshAccessToken(args: { clientId: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  }));
}

/**
 * Pages the connecting member can administer with an event-creating role.
 * Role filter happens client-side because the ACL finder accepts one role at
 * a time and we need ADMINISTRATOR **or** CONTENT_ADMINISTRATOR.
 */
export async function fetchAdministeredOrganizations(): Promise<{ organizationUrn: string; name: string | null }[]> {
  const res = await restRequest('/organizationAcls?q=member&state=APPROVED&count=100');
  const elements = ((res.json as { elements?: Array<Record<string, unknown>> } | null)?.elements ?? []) as Array<Record<string, unknown>>;
  const allowedRoles = new Set(['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR']);
  const orgs = elements
    .filter((e) => allowedRoles.has(String(e.role ?? '').toUpperCase()) && typeof e.organization === 'string')
    .map((e) => ({ organizationUrn: e.organization as string, name: null as string | null }));

  // Best-effort name enrichment — a missing name must never fail the connect.
  for (const org of orgs.slice(0, 5)) {
    try {
      const detail = await restRequest(`/organizations/${encodeURIComponent(org.organizationUrn)}`);
      const j = (detail.json ?? {}) as { localizedName?: string; vanityName?: string };
      org.name = j.localizedName || j.vanityName || null;
    } catch {
      /* leave nameless */
    }
  }
  return orgs;
}