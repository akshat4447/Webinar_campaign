/**
 * This app's externally-visible origin, as seen by the browser — not
 * `request.url`'s raw host, which is the origin Next.js itself received the
 * request on. Behind a reverse proxy or a dev tunnel (ngrok, ...) those
 * differ, and an OAuth redirect_uri built from the wrong one no longer
 * matches what was registered with the provider or what was sent in the
 * authorize step, so the token exchange is rejected outright.
 *
 * Zoom's and LinkedIn's `connect` routes already built this correctly; their
 * `callback` routes each had their own copy that used `new URL(request.url).origin`
 * instead and could silently diverge from it — a real HTTP 400 behind any
 * proxy, and a bug that existed twice because there was no shared helper to
 * keep the two ends of each OAuth flow in agreement.
 */
export function requestOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  const proto = request.headers.get('x-forwarded-proto') || (request.url.startsWith('https') ? 'https' : 'http');
  return `${proto}://${host}`;
}
