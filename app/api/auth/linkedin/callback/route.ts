// Step 2 of OAuth: validate state, exchange the code, store tokens, resolve
// which administered Page to publish as, and land back on Integrations with a
// human-readable result in the query string.
import { db } from '@/lib/db';
import { resolveIntegrationField, saveIntegrationConfig } from '@/lib/integrationConfig';
import { exchangeCodeForToken, fetchAdministeredOrganizations } from '@/lib/linkedin/auth';

export const runtime = 'nodejs';

function back(request: Request, params: Record<string, string>) {
  const url = new URL('/integrations', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');

  if (params.get('error')) {
    return back(request, { connected: 'error', detail: params.get('error_description') || params.get('error')! });
  }
  if (!code || !state) return back(request, { connected: 'error', detail: 'Missing code/state from LinkedIn.' });

  // CSRF check: the state we issued ≤10 minutes ago must match exactly.
  const [storedState, storedAt] = await Promise.all([
    db.appSetting.findUnique({ where: { key: 'integration.linkedin.oauthState' } }),
    db.appSetting.findUnique({ where: { key: 'integration.linkedin.oauthStateAt' } }),
  ]);
  const fresh = storedAt && Date.now() - new Date(storedAt.value).getTime() < 10 * 60 * 1000;
  if (!storedState?.value || storedState.value !== state || !fresh) {
    return back(request, { connected: 'error', detail: 'OAuth state mismatch or expired — start the connection again.' });
  }
  await db.appSetting.deleteMany({ where: { key: { in: ['integration.linkedin.oauthState', 'integration.linkedin.oauthStateAt'] } } });

  try {
    const clientId = (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/linkedin/callback`;

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
    });
  } catch (err) {
    return back(request, { connected: 'error', detail: String(err instanceof Error ? err.message : err).slice(0, 280) });
  }
}