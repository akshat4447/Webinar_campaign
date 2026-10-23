// Step 2 of OAuth: validate state, exchange the code, store tokens, resolve
// which administered Page to publish as, and land back on Integrations with a
// human-readable result in the query string.
import { resolveIntegrationField, saveIntegrationConfig } from '@/lib/integrationConfig';
import { exchangeCodeForToken, fetchAdministeredOrganizations } from '@/lib/linkedin/auth';
import { db } from '@/lib/db';
import { requestOrigin } from '@/lib/requestOrigin';
import { oauthRedirect, takeOAuthReturn } from '@/lib/oauthReturn';

export const runtime = 'nodejs';

function back(request: Request, params: Record<string, string>, returnTo: string | null = null) {
  return oauthRedirect(request, { params, returnTo, ok: params.connected === 'ok' });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  // The destination remembered when the connection started; consumed here so it is used once.
  const returnTo = await takeOAuthReturn('linkedin', state);

  if (params.get('error')) {
    return back(request, { connected: 'error', detail: params.get('error_description') || params.get('error')! }, returnTo);
  }
  if (!code || !state) return back(request, { connected: 'error', detail: 'Missing code/state from LinkedIn.' }, returnTo);

  // CSRF check: check HttpOnly cookie first, or fall back to a short-lived
  // DB state record — same fallback as app/api/auth/zoom/callback/route.ts.
  const cookieState = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('li_oauth_state='))
    ?.split('=')[1];

  let stateValid = !!(state && cookieState && cookieState === state);

  if (!stateValid && state) {
    try {
      const row = await db.appSetting.findUnique({ where: { key: `linkedin.oauth_state.${state}` } });
      if (row && Number(row.value) > Date.now()) {
        stateValid = true;
        await db.appSetting.delete({ where: { key: `linkedin.oauth_state.${state}` } }).catch(() => {});
      }
    } catch {
      // ignore db error
    }
  }

  if (!stateValid) {
    return back(request, { connected: 'error', detail: 'OAuth state mismatch or expired — start the connection again.' }, returnTo);
  }

  try {
    const clientId = (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET!;
    // Must byte-for-byte match what /connect sent LinkedIn in the authorize
    // step, or the token exchange is rejected — request.url's raw origin
    // isn't that, behind any proxy or tunnel that rewrites Host.
    const redirectUri =
      (await resolveIntegrationField('linkedin', 'redirectUri')) ||
      process.env.LINKEDIN_REDIRECT_URI ||
      `${requestOrigin(request)}/api/auth/linkedin/callback`;

    const token = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri });
    await saveIntegrationConfig('linkedin', {
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      ...(token.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + token.expiresInSec * 1000).toISOString() } : {}),
    });

    const orgs = await fetchAdministeredOrganizations();
    if (orgs.length > 0) {
      await saveIntegrationConfig('linkedin', {
        organizationUrn: orgs[0].organizationUrn,
        ...(orgs[0].name ? { organizationName: orgs[0].name } : {}),
      });
    }

    return back(request, {
      connected: 'ok',
      detail: orgs.length > 0 ? `Connected — publishing as ${orgs[0].name ?? orgs[0].organizationUrn}` : 'Connected, but no Page with ADMINISTRATOR/CONTENT_ADMINISTRATOR role was found.',
    }, returnTo);
  } catch (err) {
    return back(request, { connected: 'error', detail: String(err instanceof Error ? err.message : err).slice(0, 280) }, returnTo);
  }
}
