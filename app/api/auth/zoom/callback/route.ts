// Step 2 of OAuth: validate state, exchange the code, store tokens, resolve
// which Zoom account connected, and land back on Integrations with a
// human-readable result in the query string. Mirrors
// app/api/auth/linkedin/callback.
import { resolveIntegrationField, saveIntegrationConfig, saveTestResult } from '@/lib/integrationConfig';
import { exchangeCodeForToken, fetchConnectedUser } from '@/lib/zoom/auth';

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
  if (!code || !state) return back(request, { connected: 'error', detail: 'Missing code/state from Zoom.' });

  // CSRF check: the state must match the HttpOnly cookie this browser received
  // from /connect (single browser-bound token — no shared server row).
  const cookieState = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('zoom_oauth_state='))
    ?.split('=')[1];

  if (!state || !cookieState || cookieState !== state) {
    return back(request, { connected: 'error', detail: 'OAuth state mismatch or expired — start the connection again.' });
  }

  try {
    const clientId = (await resolveIntegrationField('zoom', 'clientId')) || process.env.ZOOM_CLIENT_ID!;
    const clientSecret = (await resolveIntegrationField('zoom', 'clientSecret')) || process.env.ZOOM_CLIENT_SECRET!;
    const redirectUri = process.env.ZOOM_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/zoom/callback`;

    const token = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri });
    await saveIntegrationConfig('zoom', {
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      ...(token.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + token.expiresInSec * 1000).toISOString() } : {}),
    });

    const user = await fetchConnectedUser(token.accessToken);
    if (user.email) await saveIntegrationConfig('zoom', { connectedEmail: user.email });

    const detail = user.email ? `Connected as ${user.email}` : 'Connected, but could not read the account email.';
    // So the card's badge reflects reality immediately, rather than sitting on
    // "Not tested yet" until someone happens to open Configure and click Test.
    await saveTestResult('zoom', true, detail);

    return back(request, { connected: 'ok', detail });
  } catch (err) {
    return back(request, { connected: 'error', detail: String(err instanceof Error ? err.message : err).slice(0, 280) });
  }
}
