import { NextResponse } from 'next/server';

const COOKIE_NAME = 'central_auth';

function isCronRequest(req) {
  // Vercel Cron Jobs send `Authorization: Bearer $CRON_SECRET` automatically
  // when a CRON_SECRET env var is set on the project — set one in Vercel and
  // this lets the scheduled sync through without the login cookie.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export function proxy(req) {
  const { pathname } = req.nextUrl;

  if (
    pathname === '/login' ||
    pathname === '/api/login' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  if (isCronRequest(req)) {
    return NextResponse.next();
  }

  const authed = req.cookies.get(COOKIE_NAME)?.value === 'ok';
  if (!authed) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
