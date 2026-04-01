import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import { ChargeWindow, mergeAdjacentSlots } from './engine';

export function findNegativePriceSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_price_charging !== 'true') return [];

  const negativeSlots = rates.filter((r) => r.price_inc_vat < 0);
  if (negativeSlots.length === 0) return [];

  negativeSlots.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(negativeSlots);
}

export function findPreDischargeSlots(
  rates: AgileRate[],
  negativeWindows: ChargeWindow[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_price_pre_discharge !== 'true') return [];
  if (negativeWindows.length === 0) return [];

  const rateMap = new Map(rates.map((r) => [r.valid_from, r]));
  const dischargeSlots: AgileRate[] = [];

  for (const window of negativeWindows) {
    // Find the 30-min slot immediately before this negative window
    const windowStart = new Date(window.slot_start);
    const preSlotStart = new Date(windowStart.getTime() - 30 * 60 * 1000);

    // Try both ISO formats (with and without milliseconds) for lookup
    const preRate = rateMap.get(preSlotStart.toISOString())
      ?? rateMap.get(preSlotStart.toISOString().replace('.000Z', 'Z'));

    if (preRate && preRate.price_inc_vat >= 0) {
      dischargeSlots.push(preRate);
    }
  }

  if (dischargeSlots.length === 0) return [];

  // Deduplicate (in case multiple negative windows share a pre-slot)
  const unique = [...new Map(dischargeSlots.map((s) => [s.valid_from, s])).values()];
  unique.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(unique, 'discharge');
}
