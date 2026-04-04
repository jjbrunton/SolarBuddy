import { NextResponse } from 'next/server';
import { getStoredRates, fetchAndStoreRates } from '@/lib/octopus/rates';
import { getStoredExportRates } from '@/lib/octopus/export-rates';
import { getVirtualExportRates, getVirtualNow, getVirtualRates, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  const rates = isVirtualModeEnabled() ? getVirtualRates(from, to) : getStoredRates(from, to);
  const exportRates = isVirtualModeEnabled()
    ? getVirtualExportRates(from, to)
    : getStoredExportRates(from, to);
  return NextResponse.json({ rates, exportRates });
}

export async function POST() {
  if (isVirtualModeEnabled()) {
    const now = getVirtualNow();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);
    const rates = getVirtualRates(now.toISOString(), tomorrow.toISOString());
    return NextResponse.json({ ok: true, count: rates.length, rates });
  }

  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const rates = await fetchAndStoreRates(now.toISOString(), tomorrow.toISOString());
    return NextResponse.json({ ok: true, count: rates.length, rates });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
