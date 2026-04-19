import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/config';
import { isAuthConfigured } from '@/lib/auth/state';
import { authenticateRequest } from '@/lib/auth/guard';

export async function GET(request: NextRequest) {
  const configured = isAuthConfigured();
  const kind = configured ? authenticateRequest(request) : 'none';
  return NextResponse.json({
    configured,
    authenticated: kind !== 'none',
    via: kind === 'none' ? null : kind,
    username: configured && kind !== 'none' ? getSetting('auth_username') : null,
  });
}
