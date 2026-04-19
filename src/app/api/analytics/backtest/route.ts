import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest/engine';
import { periodToISO } from '@/lib/analytics';
import { ApiError, errorResponse } from '@/lib/api-error';
import type { AppSettings } from '@/lib/config';

// Whitelist of settings keys the backtest can override. Keeps the API
// surface narrow — adding a new knob is a deliberate change.
const OVERRIDABLE_KEYS = [
  'charging_strategy',
  'price_threshold',
  'charge_hours',
  'min_soc_target',
  'smart_discharge',
  'discharge_price_threshold',
  'discharge_soc_floor',
  'always_charge_below_price',
  'solar_skip_enabled',
  'solar_skip_threshold_kwh',
] as const;

function extractOverrides(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  for (const key of OVERRIDABLE_KEYS) {
    const value = obj[key];
    if (typeof value === 'string') {
      (out as Record<string, string>)[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      (out as Record<string, string>)[key] = String(value);
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const period = typeof body.period === 'string' ? body.period : '7d';
    const fromISO = typeof body.from === 'string' ? body.from : periodToISO(period);
    const toISO = typeof body.to === 'string' ? body.to : new Date().toISOString();
    const includeSlots = body.include_slots === true;

    const result = runBacktest({
      fromISO,
      toISO,
      settingsOverrides: extractOverrides(body.settings_overrides),
      includeSlots,
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error('[api/analytics/backtest] error', err);
    return errorResponse(ApiError.serviceUnavailable('Backtest failed'));
  }
}
