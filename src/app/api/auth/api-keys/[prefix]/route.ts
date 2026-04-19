import { NextResponse } from 'next/server';
import { revokeApiKey } from '@/lib/auth/api-keys';
import { authenticateRequest } from '@/lib/auth/guard';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function DELETE(request: Request, { params }: { params: Promise<{ prefix: string }> }) {
  if (authenticateRequest(request) === 'none') {
    return errorResponse(ApiError.unauthorized('Authentication required'));
  }
  const { prefix } = await params;
  if (!prefix) return errorResponse(ApiError.badRequest('Prefix is required'));
  const ok = revokeApiKey(prefix);
  if (!ok) return errorResponse(ApiError.notFound('API key not found'));
  return NextResponse.json({ ok: true });
}
