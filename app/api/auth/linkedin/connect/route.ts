// Step 1 of OAuth: mint a CSRF state, persist it briefly, redirect to
// LinkedIn's authorize URL with every scope this feature needs.
import { randomUUID } from 'crypto';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { buildAuthorizationUrl } from '@/lib/linkedin/auth';
import { db } from '@/lib/db';
import { requestOrigin } from '@/lib/requestOrigin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const fail = (detail: string) => Response.redirect(new URL(`/integrations?connected=error&detail=${encodeURIComponent(detail)}`, origin).toString(), 302);

  const clientId = (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Save your LinkedIn app Client ID and Client Secret first (Integrations → LinkedIn).');
  }

  const configuredRedirectUri = (await resolveIntegrationField('linkedin', 'redirectUri')) || process.env.LINKEDIN_REDIRECT_URI;
  const redirectUri = configuredRedirectUri || `${origin}/api/auth/linkedin/callback`;

  const state = randomUUID();

  // Store state in AppSetting with a 10-minute expiry to bridge across
  // cross-origin/tunnel proxies where the cookie can be unreliable — same
  // fallback as app/api/auth/zoom/connect/route.ts.
  try {
    const key = `linkedin.oauth_state.${state}`;
    const expiry = String(Date.now() + 10 * 60 * 1000);
    await db.appSetting.upsert({ where: { key }, create: { key, value: expiry }, update: { value: expiry } });
  } catch {
    // Non-critical: cookie remains primary CSRF check
  }

  // CSRF state is bound to THIS browser via a short-lived HttpOnly cookie —
  // never a shared server row, which two simultaneous connects would clobber.
  const cookie = `li_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  const target = buildAuthorizationUrl({ clientId, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Set-Cookie': cookie },
  });
}
