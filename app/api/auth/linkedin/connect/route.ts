// Step 1 of OAuth: mint a CSRF state, persist it briefly, redirect to
// LinkedIn's authorize URL with every scope this feature needs.
import { randomUUID } from 'crypto';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { buildAuthorizationUrl } from '@/lib/linkedin/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const fail = (detail: string) => Response.redirect(new URL(`/integrations?connected=error&detail=${encodeURIComponent(detail)}`, origin).toString(), 302);

  const clientId = (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Save your LinkedIn app Client ID and Client Secret first (Integrations → LinkedIn).');
  }

  const state = randomUUID();
  // CSRF state is bound to THIS browser via a short-lived HttpOnly cookie —
  // never a shared server row, which two simultaneous connects would clobber.
  const cookie = `li_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${origin}/api/auth/linkedin/callback`;
  const target = buildAuthorizationUrl({ clientId, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Set-Cookie': cookie },
  });
}