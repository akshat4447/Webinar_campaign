import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SEC, authConfig, createSessionToken, credentialsMatch, safeNextPath } from '@/lib/auth';
import { allowRequest, clientIp } from '@/lib/rateLimit';
import { requestOrigin } from '@/lib/requestOrigin';

export const dynamic = 'force-dynamic';

// Attempts per address in a window. Generous for a person who mistypes, useless for guessing.
const LIMIT = { limit: 8, windowMs: 10 * 60_000 };

const back = (request: NextRequest, params: Record<string, string>) => {
  const url = new URL('/login', requestOrigin(request));
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  // 303: the browser follows a POST's answer with a GET, so a refresh never re-sends the password.
  return NextResponse.redirect(url, 303);
};

export async function POST(request: NextRequest) {
  // A page on another site must not be able to sign someone in as this operator.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new NextResponse('Forbidden', { status: 403 });

  let username = '';
  let password = '';
  let next = '/';
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      username = typeof body.username === 'string' ? body.username : '';
      password = typeof body.password === 'string' ? body.password : '';
      next = safeNextPath(body.next);
    } else {
      const form = await request.formData();
      username = String(form.get('username') ?? '');
      password = String(form.get('password') ?? '');
      next = safeNextPath(form.get('next'));
    }
  } catch {
    return back(request, { error: 'invalid' });
  }
  if (username.length > 200 || password.length > 500) return back(request, { error: 'invalid', next });

  const cfg = authConfig();
  if (!cfg.configured) return back(request, { error: 'unconfigured' });
  // The account budget also bounds guessing when a direct client varies forwarding headers or source IPs.
  const [address, account] = await Promise.all([
    allowRequest({ scope: 'login', key: clientIp(request.headers), ...LIMIT, failurePolicy: 'closed' }),
    allowRequest({ scope: 'login-account', key: cfg.username, limit: 30, windowMs: LIMIT.windowMs, failurePolicy: 'closed' }),
  ]);
  if (!address.allowed || !account.allowed) return back(request, { error: 'rate', next });
  if (!(await credentialsMatch(username, password, cfg))) return back(request, { error: 'invalid', next });

  const token = await createSessionToken(cfg.username, Date.now(), cfg);
  if (!token) return back(request, { error: 'unconfigured' });

  const origin = requestOrigin(request);
  const response = NextResponse.redirect(new URL(next, origin), 303);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(origin).protocol === 'https:',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
  return response;
}
