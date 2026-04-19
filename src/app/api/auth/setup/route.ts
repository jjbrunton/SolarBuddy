import { NextResponse } from 'next/server';
import { saveSettings } from '@/lib/config';
import { isAuthConfigured } from '@/lib/auth/state';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, rotateSessionSecret, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function POST(request: Request) {
  if (isAuthConfigured()) {
    return errorResponse(ApiError.badRequest('Setup already complete'));
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(ApiError.badRequest('Invalid JSON body'));
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || username.length < 3) {
    return errorResponse(ApiError.badRequest('Username must be at least 3 characters'));
  }
  if (password.length < 8) {
    return errorResponse(ApiError.badRequest('Password must be at least 8 characters'));
  }

  // Rotate the session secret up front so even a leaked pre-setup secret can't
  // be used to mint a session now.
  rotateSessionSecret();
  saveSettings({
    auth_username: username,
    auth_password_hash: hashPassword(password),
  });

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
