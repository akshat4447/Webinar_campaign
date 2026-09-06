import { randomUUID } from 'crypto';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { buildAuthorizationUrl } from '@/lib/zoom/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  const proto = request.headers.get('x-forwarded-proto') || (request.url.startsWith('https') ? 'https' : 'http');
  const origin = `${proto}://${host}`;
  const fail = (detail: string) => Response.redirect(new URL(`/integrations?connected=error&detail=${encodeURIComponent(detail)}`, origin).toString(), 302);

  const clientId = (await resolveIntegrationField('zoom', 'clientId')) || process.env.ZOOM_CLIENT_ID;
  const clientSecret = (await resolveIntegrationField('zoom', 'clientSecret')) || process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Save your Zoom app Client ID and Client Secret first (Integrations → Zoom).');
  }

  const configuredRedirectUri = (await resolveIntegrationField('zoom', 'redirectUri')) || process.env.ZOOM_REDIRECT_URI;
  const redirectUri = configuredRedirectUri || `${origin}/api/auth/zoom/callback`;

  const state = randomUUID();

  // Store state in AppSetting with a 10-minute expiry to bridge across cross-origin/tunnel proxies
  try {
    const key = `zoom.oauth_state.${state}`;
    const expiry = String(Date.now() + 10 * 60 * 1000);
    await db.appSetting.upsert({
      where: { key },
      create: { key, value: expiry },
      update: { value: expiry },
    });
  } catch {
    // Non-critical: cookie remains primary CSRF check
  }

  // CSRF state is bound to THIS browser via a short-lived HttpOnly cookie
  const cookie = `zoom_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  const target = buildAuthorizationUrl({ clientId, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Set-Cookie': cookie },
  });
}
