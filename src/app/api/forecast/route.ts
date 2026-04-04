import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/config';
import { fetchPVForecast } from '@/lib/solcast/client';
import { storePVForecast, getStoredPVForecast, getLatestForecastAge } from '@/lib/solcast/store';
import { getVirtualForecast, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  const forecasts = isVirtualModeEnabled() ? getVirtualForecast(from, to) : getStoredPVForecast(from, to);
  const ageMinutes = isVirtualModeEnabled() ? 0 : getLatestForecastAge();
  return NextResponse.json({ forecasts, ageMinutes: Math.round(ageMinutes) });
}

export async function POST(request: Request) {
  if (isVirtualModeEnabled()) {
    return NextResponse.json({ ok: true, count: getVirtualForecast().length });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';
  const settings = getSettings();

  if (!settings.pv_latitude || !settings.pv_longitude || !settings.pv_kwp) {
    return NextResponse.json(
      { ok: false, error: 'PV system location (latitude, longitude) and capacity (kWp) must be configured' },
      { status: 400 },
    );
  }

  // Rate-limit: only fetch if data is stale (>2 hours), unless forced
  const ageMinutes = getLatestForecastAge();
  if (!force && ageMinutes < 120) {
    return NextResponse.json({
      ok: true,
      message: `Forecast data is ${Math.round(ageMinutes)} minutes old — still fresh, skipping API call`,
      count: 0,
    });
  }

  try {
    const forecasts = await fetchPVForecast(
      settings.pv_latitude,
      settings.pv_longitude,
      settings.pv_declination || '35',
      settings.pv_azimuth || '0',
      settings.pv_kwp,
    );

    if (forecasts.length > 0) {
      storePVForecast(forecasts);
    }

    return NextResponse.json({ ok: true, count: forecasts.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
