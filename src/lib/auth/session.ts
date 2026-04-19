import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, saveSettings } from '@/lib/config';

export const SESSION_COOKIE = 'sb_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// The session secret rotates whenever the user (re)runs setup or changes their
// password, which invalidates every outstanding session as a side effect —
// that's the desired behaviour for a single-user deployment.
export function getSessionSecret(): string {
  const existing = getSetting('auth_session_secret');
  if (existing) return existing;
  const fresh = randomBytes(32).toString('hex');
  saveSettings({ auth_session_secret: fresh });
  return fresh;
}

export function rotateSessionSecret(): string {
  const fresh = randomBytes(32).toString('hex');
  saveSettings({ auth_session_secret: fresh });
  return fresh;
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export function createSessionToken(): string {
  const secret = getSessionSecret();
  const exp = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = b64url(Buffer.from(JSON.stringify({ v: 1, exp })));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const secret = getSessionSecret();
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(fromB64url(payload).toString()) as { exp: number };
    if (typeof exp !== 'number' || Date.now() > exp) return false;
  } catch {
    return false;
  }
  return true;
}
