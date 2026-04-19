import { NextResponse } from 'next/server';
import { isCookieSecure, SESSION_COOKIE } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isCookieSecure(),
    path: '/',
    maxAge: 0,
  });
  return res;
}
