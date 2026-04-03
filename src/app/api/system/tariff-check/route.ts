import { NextResponse } from 'next/server';
import { checkForTariffChange } from '@/lib/octopus/tariff-monitor';

export async function POST() {
  try {
    const result = await checkForTariffChange();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
