/**
 * Wholesale-to-Agile rate converter.
 *
 * Applies the Predbat-style formula to convert Nordpool N2EX wholesale prices
 * into estimated Octopus Agile retail rates:
 *
 *   price_exc_vat = min(D × W + P, CAP)
 *   price_inc_vat = price_exc_vat × (1 + VAT)
 *
 * Where:
 *   D   = distribution multiplier (~2.0–2.4, default 2.2)
 *   W   = wholesale price in p/kWh
 *   P   = peak adder (applied only during peak hours, e.g. 16:00–19:00)
 *   CAP = pre-VAT price cap (95 p/kWh)
 *   VAT = 5%
 */

import type { NordpoolSlot } from './client';
import type { AgileRate } from '../octopus/rates';

export interface ConversionParams {
  /** Distribution cost multiplier (default 2.2). */
  distributionMultiplier: number;
  /** Peak-time adder in p/kWh (default 12.5, 0 outside peak). */
  peakAdder: number;
  /** Peak period start hour in UK time, 0-23 (default 16). */
  peakStartHour: number;
  /** Peak period end hour in UK time, 0-23 (default 19). */
  peakEndHour: number;
}

const PRE_VAT_CAP = 95;
const VAT_RATE = 0.05;

/** Parse "HH:MM" to hour number. */
export function parseHour(time: string): number {
  const [h] = time.split(':').map(Number);
  return h;
}

/**
 * Get the UK hour for a given ISO timestamp.
 * Uses Europe/London to handle BST/GMT transitions.
 */
function getUKHour(isoTimestamp: string): number {
  const date = new Date(isoTimestamp);
  const ukTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(date);
  return parseInt(ukTime, 10);
}

/**
 * Convert Nordpool wholesale slots to estimated Agile retail rates.
 */
export function convertToAgileRates(slots: NordpoolSlot[], params: ConversionParams): AgileRate[] {
  return slots.map((slot) => {
    const ukHour = getUKHour(slot.valid_from);
    const isPeak = ukHour >= params.peakStartHour && ukHour < params.peakEndHour;
    const adder = isPeak ? params.peakAdder : 0;

    const raw = params.distributionMultiplier * slot.wholesale_price_pkwh + adder;
    const capped = Math.min(raw, PRE_VAT_CAP);
    const incVat = capped * (1 + VAT_RATE);
    const excVat = capped;

    return {
      valid_from: slot.valid_from,
      valid_to: slot.valid_to,
      price_inc_vat: Math.round(incVat * 100) / 100,
      price_exc_vat: Math.round(excVat * 100) / 100,
      source: 'nordpool' as const,
    };
  });
}
