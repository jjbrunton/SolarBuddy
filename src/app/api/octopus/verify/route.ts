import { NextResponse } from 'next/server';
import { verifyAccount } from '@/lib/octopus/account';

/**
 * POST /api/octopus/verify
 *
 * Verifies Octopus Energy credentials and returns auto-detected account details.
 *
 * Request:  { apiKey: string, accountNumber: string }
 * Success:  { ok: true, account: { accountNumber, mpan, meterSerial, tariffCode, productCode, region, regionName } }
 * Failure:  { ok: false, error: string }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { apiKey, accountNumber } = body as { apiKey?: string; accountNumber?: string };

  if (!apiKey || !accountNumber) {
    return NextResponse.json(
      { ok: false, error: 'API key and account number are required' },
      { status: 400 }
    );
  }

  const result = await verifyAccount(apiKey, accountNumber);

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
