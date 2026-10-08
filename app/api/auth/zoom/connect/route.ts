import { randomUUID } from 'crypto';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { buildAuthorizationUrl } from '@/lib/zoom/auth';
import { storeOAuthState } from '@/lib/zoom/oauthState';
import { requestOrigin } from '@/lib/requestOrigin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const fail = (detail: string) => Response.redirect(new URL(`/integrations?connected=error&detail=${encodeURIComponent(detail)}`, origin).toString(), 302);

  const clientId = (await resolveIntegrationField('zoom', 'clientId')) || process.env.ZOOM_CLIENT_ID;
  const clientSecret = (await resolveIntegrationField('zoom', 'clientSecret')) || process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Save your Zoom app Client ID and Client Secret first (Integrations → Zoom).');
  }

  const configuredRedirectUri = (await resolveIntegrationField('zoom', 'redirectUri')) || process.env.ZOOM_REDIRECT_URI;
  let redirectUri = configuredRedirectUri || `${origin}/api/auth/zoom/callback`;
  if (!redirectUri || redirectUri.includes('zoom.us')) {
    redirectUri = `${origin}/api/auth/zoom/callback`;
  }

  const state = randomUUID();

  // Server-side copy with a 10-minute expiry, for setups where the cookie is lost between redirects.
  try {
    await storeOAuthState(state);
  } catch {
    // Non-critical: the cookie remains the primary CSRF check
  }

  // CSRF state is bound to THIS browser via a short-lived HttpOnly cookie
  const cookie = `zoom_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  const target = buildAuthorizationUrl({ clientId, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Set-Cookie': cookie },
  });
}
