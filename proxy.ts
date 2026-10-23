import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isPublicPath, verifySessionToken } from '@/lib/auth';

// Everything except the sign-in page and the public attendee/provider endpoints (see isPublicPath) needs a valid
// session. A page request without one is sent to /login and brought back afterwards; an API call or a form post
// from a stale tab gets a plain 401, which is something a script or the client can act on, unlike a redirect.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Reject action replays on public pages too, before Next forwards/parses an action body.
  if (request.headers.has('next-action') && !(await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // Starting a Zoom or LinkedIn connection, and the browser's return from them, are page visits that happen to live
  // under /api. Answer them with the sign-in page and bring the person back with the one-time code still in the
  // address, rather than a bare "Sign in required" that strands a half-finished connection.
  const isOAuthReturn = /^\/api\/auth\/(zoom|linkedin)\/(connect|callback)\/?$/.test(pathname);
  const isPageRead = (request.method === 'GET' || request.method === 'HEAD') && (!pathname.startsWith('/api/') || isOAuthReturn);
  if (!isPageRead) {
    return new NextResponse(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Only actual public asset directories bypass the gate; a dynamic route ending in .css is not an asset.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|logos/).*)'],
};
