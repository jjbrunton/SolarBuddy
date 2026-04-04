import { NextResponse } from 'next/server';
import { verifyAccount } from '@/lib/octopus/account';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function POST(request: Request) {
  const body = await request.json();
  const { apiKey, accountNumber } = body as { apiKey?: string; accountNumber?: string };

  if (!apiKey || !accountNumber) {
    return errorResponse(ApiError.badRequest('API key and account number are required'));
  }

  const result = await verifyAccount(apiKey, accountNumber);

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
