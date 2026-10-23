// The redirect URI sent to Zoom when connecting a user-managed app, and a check that it can actually bring the
// person back. A saved address that points at a closed tunnel sent people to Zoom's "Error" page, or to a dead
// address after they had approved the connection, with nothing in the app saying why.

export function zoomCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/auth/zoom/callback`;
}

/**
 * The redirect URI the connect and callback routes both use. They must agree byte for byte, or Zoom refuses the
 * token exchange. A saved value wins (it is how a live tunnel is used); a value pointing at zoom.us itself is a
 * mistake that is ignored.
 */
export function effectiveZoomRedirectUri(configured: string | undefined | null, requestOrigin: string): string {
  const saved = (configured ?? '').trim();
  if (!saved || saved.includes('zoom.us')) return zoomCallbackUrl(requestOrigin);
  return saved;
}

/**
 * Null when the redirect URI is fine. A URI on this server's own address always is (the person is already
 * here). One on another address is probed: if nothing answers there, or what answers is not this app, Zoom would
 * send the person to a dead page after they approve, so the connection is stopped with an explanation.
 */
export async function zoomRedirectProblem(redirectUri: string, requestOrigin: string, probe: typeof fetch = fetch): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return `The saved Redirect URI (${redirectUri.slice(0, 120)}) is not a valid address.`;
  }
  if (target.origin === new URL(requestOrigin).origin) return null;
  try {
    const res = await probe(`${target.origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
    if (res.ok) return null;
  } catch {
    // unreachable: reported below
  }
  return (
    `The saved Redirect URI (${target.origin}) does not answer, so Zoom could not send you back after you approve. ` +
    `If it was a temporary tunnel that has closed, clear the Redirect URI on Integrations → Zoom and add ${zoomCallbackUrl(requestOrigin)} ` +
    `to the Zoom app's OAuth redirect URL and OAuth allow list.`
  );
}

/**
 * Where to continue the connection when the saved Redirect URI is on a different address from the one the person is
 * on (a tunnel, while they opened Studio on localhost). Zoom sends them back to the Redirect URI's address, and
 * their sign-in and the security check cookie belong to the address they started on, so the connection must start
 * there. Null when they are already on it, or when they were already sent across once (so it can never loop).
 */
export function zoomConnectHop(redirectUri: string, requestOrigin: string, requestUrl: string): string | null {
  try {
    const target = new URL(redirectUri);
    if (target.origin === new URL(requestOrigin).origin) return null;
    const incoming = new URL(requestUrl);
    if (incoming.searchParams.get('hop')) return null;
    const next = new URL('/api/auth/zoom/connect', target.origin);
    incoming.searchParams.forEach((v, k) => next.searchParams.set(k, v));
    next.searchParams.set('hop', '1');
    return next.toString();
  } catch {
    return null;
  }
}

/**
 * True for an address on this machine only (localhost, 127.x, ::1). Zoom staff say on the developer forum that
 * localhost is not supported as a redirect URL, and people report error 4,700 ("Invalid redirect") even with the
 * exact address on the allow list. It is a reason to connect another way, not something this app can fix.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}
