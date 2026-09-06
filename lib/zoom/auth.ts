// OAuth 2.0 three-legged flow for a Zoom "User-managed" Marketplace app —
// this is the same shape as the "Connect with Zoom" a real Zoom Marketplace
// integration (e.g. one published by LeadSquared) uses: the operator's own
// Zoom account grants consent in a browser, not a shared account-level
// Server-to-Server credential. See https://developers.zoom.us/docs/integrations/oauth/
//
// Granular scopes (Zoom's naming since April 2024 — any app created since
// then only offers these, not the old classic meeting:read/report:read
// names):
//   meeting:read:list_upcoming_meetings  lib/zoom/meetings.ts listUpcomingMeetings
//   meeting:write:meeting                                    createMeeting
//   meeting:read:list_past_participants                      fetchParticipants
//   user:read:user                       lib/zoom/auth.ts fetchConnectedUser
//
// Deliberately NOT report:read:list_meeting_participants — that one only
// comes in :admin/:master variants, which a plain user-managed app can't
// obtain for a non-admin connected account. list_past_participants is the
// equivalent that a regular Zoom user actually can grant; see the switch to
// /past_meetings/{id}/participants in lib/zoom/meetings.ts.
export const ZOOM_SCOPES = [
  'meeting:read:list_upcoming_meetings',
  'meeting:write:meeting',
  'meeting:read:list_past_participants',
  'user:read:user',
];

export const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
export const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

export function buildAuthorizationUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(ZOOM_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', ZOOM_SCOPES.join(' '));
  return url.toString();
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
}

async function tokenRequest(clientId: string, clientSecret: string, body: URLSearchParams): Promise<TokenExchangeResult> {
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; reason?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Zoom token endpoint ${res.status}: ${json.reason || json.error || JSON.stringify(json).slice(0, 200)}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresInSec: json.expires_in };
}

export function exchangeCodeForToken(args: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  return tokenRequest(
    args.clientId,
    args.clientSecret,
    new URLSearchParams({ grant_type: 'authorization_code', code: args.code, redirect_uri: args.redirectUri })
  );
}

export function refreshAccessToken(args: { clientId: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest(args.clientId, args.clientSecret, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: args.refreshToken }));
}

/** Who the connected account is, shown on Integrations after Connect. */
export async function fetchConnectedUser(accessToken: string): Promise<{ email: string | null }> {
  const res = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return { email: null };
  const json = (await res.json().catch(() => ({}))) as { email?: string };
  return { email: json.email ?? null };
}
