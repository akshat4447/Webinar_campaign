// Operator sign-in. One username and password, taken from the environment (APP_USERNAME, APP_PASSWORD), and a
// signed session cookie. Written against Web Crypto only, so the same code runs in proxy.ts and in route handlers.
//
// The credentials are never in the source: they live in the environment (.env.local on a laptop, the hosting
// provider's settings in production). With neither set, nobody can sign in; the app does not fall back to a default.

export const SESSION_COOKIE = 'webinar_session';
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

const enc = new TextEncoder();

export interface AuthConfig {
  configured: boolean;
  username: string;
  password: string;
}

export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const username = (env.APP_USERNAME ?? '').trim();
  const password = env.APP_PASSWORD ?? '';
  return { configured: username.length > 0 && password.length > 0, username, password };
}

/** The key sessions are signed with: the app's signing secret plus the password, so changing the password signs everyone out. */
function signingMaterial(cfg: AuthConfig, env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.REGISTRATION_SECRET ?? env.AUTH_SECRET ?? '';
  if (!cfg.configured || secret.length < 32) return null;
  return `${secret}|${cfg.password}`;
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmacHex(material: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Equal-length strings compared without stopping at the first difference. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the typed credentials are the configured ones. Both fields are always compared, as digests. */
export async function credentialsMatch(username: string, password: string, cfg: AuthConfig = authConfig()): Promise<boolean> {
  if (!cfg.configured) return false;
  const sha = async (v: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(v)));
  const [uGot, uWant, pGot, pWant] = await Promise.all([sha(username.trim()), sha(cfg.username), sha(password), sha(cfg.password)]);
  const userOk = constantTimeEqual(uGot, uWant);
  const passOk = constantTimeEqual(pGot, pWant);
  return userOk && passOk;
}

/** `<expiry>.<username>.<signature>`, signed over the first two parts. */
export async function createSessionToken(username: string, nowMs: number = Date.now(), cfg: AuthConfig = authConfig(), env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const material = signingMaterial(cfg, env);
  if (!material) return null;
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SEC;
  const body = `${exp}.${b64url(username)}`;
  return `${body}.${await hmacHex(material, body)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
  cfg: AuthConfig = authConfig(),
  env: Record<string, string | undefined> = process.env,
): Promise<{ username: string } | null> {
  if (!token || token.length > 512) return null;
  const material = signingMaterial(cfg, env);
  if (!material) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expRaw, userRaw, sig] = parts;
  if (!/^\d{1,12}$/.test(expRaw) || Number(expRaw) * 1000 <= nowMs) return null;
  if (!constantTimeEqual(sig, await hmacHex(material, `${expRaw}.${userRaw}`))) return null;
  try {
    const username = fromB64url(userRaw);
    // A session for a different configured user (the username was changed) is not valid either.
    return username === cfg.username ? { username } : null;
  } catch {
    return null;
  }
}

/**
 * Where to go after signing in. Only a same-site path is accepted, rebuilt from parsed parts; anything else
 * (an absolute URL, `//host`, a backslash, the login page itself) becomes the home page.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, 'http://next.invalid');
  } catch {
    return '/';
  }
  if (url.origin !== 'http://next.invalid') return '/';
  if (url.pathname === '/login' || url.pathname.startsWith('/api/auth/login') || url.pathname.startsWith('/api/auth/logout')) return '/';
  return `${url.pathname}${url.search}`;
}

/**
 * Paths reachable without signing in: the sign-in page itself, and everything meant for people or services that
 * have no login. Attendee pages and the registration endpoint are public by design; webhooks carry their own
 * provider signatures; calendar files and the attendee hub carry signed links; the worker and health endpoints are
 * called by schedulers and uptime checks.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === '/login' || pathname === '/api/auth/login' || pathname === '/api/auth/logout') return true;
  return [
    /^\/register\/[^/]+\/?$/,
    /^\/r(\/|$)/,
    /^\/api\/landing(\/|$)/,
    /^\/api\/webhooks(\/|$)/,
    /^\/api\/calendar(\/|$)/,
    /^\/api\/health\/?$/,
    /^\/api\/cron(\/|$)/,
  ].some((re) => re.test(pathname));
}
