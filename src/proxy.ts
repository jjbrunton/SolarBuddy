import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const start = Date.now();
  const response = NextResponse.next();

  // Add timing header for observability
  response.headers.set('X-Response-Time', `${Date.now() - start}ms`);

  // Log non-SSE API requests
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/') && !path.includes('/events') && !path.includes('/mqtt-log')) {
    console.log(`[API] ${request.method} ${path}`);
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
