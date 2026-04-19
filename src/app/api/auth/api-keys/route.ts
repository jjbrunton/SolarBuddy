import { NextResponse } from 'next/server';
import { generateApiKey, listApiKeys } from '@/lib/auth/api-keys';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET() {
  return NextResponse.json({ keys: listApiKeys() });
}

export async function POST(request: Request) {
  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse(ApiError.badRequest('Invalid JSON body'));
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return errorResponse(ApiError.badRequest('Name is required'));
  if (name.length > 64) return errorResponse(ApiError.badRequest('Name must be 64 characters or fewer'));

  const { key, summary } = generateApiKey(name);
  // The plaintext `key` is returned exactly once — clients must copy it now.
  return NextResponse.json({ ok: true, key, summary });
}
