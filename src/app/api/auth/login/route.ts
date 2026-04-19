import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/config';
import { isAuthConfigured } from '@/lib/auth/state';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, isCookieSecure, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: 'setup_required' }, { status: 409 });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(ApiError.badRequest('Invalid JSON body'));
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const storedUsername = getSetting('auth_username');
  const storedHash = getSetting('auth_password_hash');

  // Always run scrypt even if the username is wrong so login timing doesn't
  // leak whether the account exists.
  const usernameOk = username.length > 0 && username === storedUsername;
  const passwordOk = verifyPassword(password, storedHash);

  if (!usernameOk || !passwordOk) {
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
  }

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true, username: storedUsername });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isCookieSecure(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
