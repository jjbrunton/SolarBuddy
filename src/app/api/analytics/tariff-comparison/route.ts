import { NextResponse } from 'next/server';
import { runTariffComparison } from '@/lib/tariff-comparison';
import type { TariffType } from '@/lib/tariffs/definitions';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '30d';
  const targetTariff = (searchParams.get('target_tariff') || 'go') as TariffType;

  const customRates = {
    offpeak: searchParams.get('offpeak') ?? undefined,
    peak: searchParams.get('peak') ?? undefined,
    standard: searchParams.get('standard') ?? undefined,
    export: searchParams.get('export') ?? undefined,
  };

  return NextResponse.json({
    period,
    targetTariff,
    ...runTariffComparison(period, targetTariff, customRates),
  });
}
