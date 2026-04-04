import { checkForTariffChange } from '@/lib/octopus/tariff-monitor';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-error';

export async function POST() {
  try {
    const result = await checkForTariffChange();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
