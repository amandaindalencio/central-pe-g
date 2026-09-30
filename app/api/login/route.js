import { NextResponse } from 'next/server';

const COOKIE_NAME = 'central_auth';

export async function POST(req) {
  const { password } = await req.json();
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'DASHBOARD_PASSWORD não configurada no servidor' }, { status: 500 });
  }
  if (password === expected) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, 'ok', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return res;
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}
