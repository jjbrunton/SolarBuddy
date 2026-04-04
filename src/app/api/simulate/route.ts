import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/config';
import { getStoredRates } from '@/lib/octopus/rates';
import { getStoredExportRates } from '@/lib/octopus/export-rates';
import { getStoredPVForecast } from '@/lib/solcast/store';
import { getState } from '@/lib/state';
import { runFullSimulation } from '@/lib/simulator';
import {
  getVirtualExportRates,
  getVirtualForecast,
  getVirtualNow,
  getVirtualRates,
  isVirtualModeEnabled,
} from '@/lib/virtual-inverter/runtime';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const settings = getSettings();
  const state = getState();

  const startSoc = body.start_soc ?? state.battery_soc ?? 50;

  // Merge any settings overrides
  const effectiveSettings = body.settings_overrides
    ? { ...settings, ...body.settings_overrides }
    : settings;

  // Get rates for next 24 hours
  const now = getVirtualNow();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 0, 0);

  const rates = isVirtualModeEnabled()
    ? getVirtualRates(now.toISOString(), tomorrow.toISOString())
    : getStoredRates(now.toISOString(), tomorrow.toISOString());
  if (rates.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No rates available. Fetch rates first.' },
      { status: 400 },
    );
  }

  const exportRates = isVirtualModeEnabled()
    ? getVirtualExportRates(now.toISOString(), tomorrow.toISOString())
    : getStoredExportRates(now.toISOString(), tomorrow.toISOString());
  const pvForecast = effectiveSettings.pv_forecast_enabled === 'true'
    ? isVirtualModeEnabled()
      ? getVirtualForecast(now.toISOString(), tomorrow.toISOString())
      : getStoredPVForecast(now.toISOString(), tomorrow.toISOString())
    : [];

  const result = runFullSimulation({
    rates,
    settings: effectiveSettings,
    startSoc,
    exportRates: exportRates.length > 0 ? exportRates : undefined,
    pvForecast: pvForecast.length > 0 ? pvForecast : undefined,
    now,
  });

  return NextResponse.json({
    ok: true,
    startSoc,
    ...result,
    _dischargeDebug: result.plan._dischargeDebug,
  });
}
