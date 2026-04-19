import { NextResponse } from 'next/server';
import { saveSettings } from '@/lib/config';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, rotateSessionSecret, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { ApiError, errorResponse } from '@/lib/api-error';

// Changing the password rotates the session secret, which logs every other
// device out. The current request is re-issued a fresh cookie so the caller
// doesn't get locked out of the UI mid-flow.
//
// SolarBuddy is a single-user self-hosted app, so we don't ask for the
// existing password: the proxy has already verified the caller holds a valid
// session (or API key) before the request reaches this handler, and on a
// personal deployment that proof of control is sufficient. Anyone who's lost
// access can still reset via the runbook.
export async function POST(request: Request) {
  let body: { new_password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(ApiError.badRequest('Invalid JSON body'));
  }

  const next = typeof body.new_password === 'string' ? body.new_password : '';
  if (next.length < 8) {
    return errorResponse(ApiError.badRequest('Password must be at least 8 characters'));
  }

  saveSettings({ auth_password_hash: hashPassword(next) });
  rotateSessionSecret();

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
