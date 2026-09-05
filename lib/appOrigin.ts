/**
 * This app's own public origin, for building absolute URLs from code that has
 * no request to read a Host header from — the cadence tick, a CLI script, a
 * background job.
 *
 * Inside a route handler, prefer the request's own origin (see
 * app/api/auth/linkedin/connect/route.ts for that pattern); this exists for
 * everywhere else. Falls back to localhost:3000 so local dev and the CLI
 * scripts work without configuration — a one-click link built from that
 * fallback still resolves during `npm run dev`, it just is not the one to
 * ship in real mail.
 */
export function appOrigin(): string {
  return (process.env.APP_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
}
