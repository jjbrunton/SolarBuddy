/**
 * Shared Nordpool day-ahead refresh routine.
 *
 * Used by both the scheduled cron (11:15 / 11:30 / 11:45 UK time) and the
 * manual `/api/rates/nordpool/refresh` endpoint. Fetches tomorrow's day-ahead
 * prices, converts them to estimated Agile retail rates using the configured
 * distribution multiplier / peak adder, and writes them to the rate repository.
 *
 * Callers are responsible for replanning afterwards.
 */

import { getSettings } from '../config';
import { fetchNordpoolDayAhead } from './client';
import { convertToAgileRates, parseHour } from './converter';
import { storeImportRates } from '../db/rate-repository';
import { appendEvent } from '../events';

export type NordpoolRefreshResult =
  | { status: 'ok'; date: string; count: number }
  | { status: 'skipped'; reason: 'disabled' | 'not_agile' | 'no_prices'; date: string }
  | { status: 'error'; message: string };

export async function refreshNordpoolForecast(): Promise<NordpoolRefreshResult> {
  const settings = getSettings();

  if (settings.nordpool_forecast_enabled !== 'true') {
    return { status: 'skipped', reason: 'disabled', date: '' };
  }
  if (settings.tariff_type !== 'agile') {
    return { status: 'skipped', reason: 'not_agile', date: '' };
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);

  try {
    const slots = await fetchNordpoolDayAhead(dateStr);
    if (slots.length === 0) {
      console.log(`[Nordpool] No prices available yet for ${dateStr}`);
      return { status: 'skipped', reason: 'no_prices', date: dateStr };
    }

    const rates = convertToAgileRates(slots, {
      distributionMultiplier: parseFloat(settings.nordpool_distribution_multiplier) || 2.2,
      peakAdder: parseFloat(settings.nordpool_peak_adder) || 12.5,
      peakStartHour: parseHour(settings.nordpool_peak_start || '16:00'),
      peakEndHour: parseHour(settings.nordpool_peak_end || '19:00'),
    });

    storeImportRates(rates, 'nordpool');
    appendEvent({
      level: 'success',
      category: 'nordpool',
      message: `Nordpool forecast: stored ${rates.length} estimated Agile rates for ${dateStr}`,
    });

    return { status: 'ok', date: dateStr, count: rates.length };
  } catch (err) {
    console.error('[Nordpool] Day-ahead fetch failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    appendEvent({
      level: 'warning',
      category: 'nordpool',
      message: `Nordpool forecast failed: ${message}`,
    });
    return { status: 'error', message };
  }
}
