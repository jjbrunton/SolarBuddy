import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './session';
import { extractApiKey, verifyApiKey } from './api-keys';

export type AuthKind = 'session' | 'api-key' | 'none';

export function authenticateRequest(request: NextRequest | Request): AuthKind {
  const apiKey = extractApiKey(request);
  if (apiKey && verifyApiKey(apiKey)) return 'api-key';

  const token = readSessionCookie(request);
  if (token && verifySessionToken(token)) return 'session';

  return 'none';
}

function readSessionCookie(request: NextRequest | Request): string | null {
  if ('cookies' in request && typeof (request as NextRequest).cookies?.get === 'function') {
    return (request as NextRequest).cookies.get(SESSION_COOKIE)?.value ?? null;
  }
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}
