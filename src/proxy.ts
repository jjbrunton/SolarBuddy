import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigured } from '@/lib/auth/state';
import { authenticateRequest } from '@/lib/auth/guard';

// Paths that must stay reachable regardless of auth state. /api/health is on
// the list so uptime checks and container orchestrators keep working; the
// listed auth endpoints are the bootstrap surface (log in, log out, first-run
// setup, status probe). Other /api/auth/* routes — password change, API key
// management — are sensitive and must go through the authenticated gate.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/auth/status',
  '/api/health',
]);
const PUBLIC_PAGE_PATHS = ['/login', '/setup'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.includes(pathname)) return true;
  for (const p of PUBLIC_PAGE_PATHS) {
    if (pathname.startsWith(`${p}/`)) return true;
  }
  return PUBLIC_API_PATHS.has(pathname);
}

function unauthorized(code: 'setup_required' | 'unauthorized'): NextResponse {
  const status = code === 'setup_required' ? 409 : 401;
  return NextResponse.json({ ok: false, error: code }, { status });
}

function withTiming(start: number, response: NextResponse): NextResponse {
  response.headers.set('X-Response-Time', `${Date.now() - start}ms`);
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const start = Date.now();
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Preserve the previous observability behaviour for API requests.
  if (isApi && !pathname.includes('/events') && !pathname.includes('/mqtt-log')) {
    console.log(`[API] ${request.method} ${pathname}`);
  }

  const publicPath = isPublicPath(pathname);
  const configured = isAuthConfigured();

  if (!configured) {
    if (publicPath) {
      if (pathname === '/login') {
        return withTiming(start, NextResponse.redirect(new URL('/setup', request.url)));
      }
      return withTiming(start, NextResponse.next());
    }
    if (isApi) return withTiming(start, unauthorized('setup_required'));
    return withTiming(start, NextResponse.redirect(new URL('/setup', request.url)));
  }

  const authed = authenticateRequest(request) !== 'none';

  if (publicPath) {
    if (authed && (pathname === '/login' || pathname === '/setup')) {
      return withTiming(start, NextResponse.redirect(new URL('/', request.url)));
    }
    return withTiming(start, NextResponse.next());
  }

  if (authed) return withTiming(start, NextResponse.next());

  if (isApi) return withTiming(start, unauthorized('unauthorized'));

  const loginUrl = new URL('/login', request.url);
  const nextParam = `${pathname}${request.nextUrl.search}`;
  if (nextParam !== '/') loginUrl.searchParams.set('next', nextParam);
  return withTiming(start, NextResponse.redirect(loginUrl));
}

// Exclude static assets and Next internals. Everything else — pages and API —
// must run through the proxy so the gate is impossible to bypass by mistake.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|sw.js|icons/|robots.txt).*)',
  ],
};
