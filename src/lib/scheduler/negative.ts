import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import { toSlotKey } from '../slot-key';
import { calculateSlotsNeeded, ChargeWindow, mergeAdjacentSlots } from './engine';

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

export function findAlwaysCheapSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  const threshold = parseFloat(settings.always_charge_below_price) || 0;
  if (threshold <= 0) return [];

  // Slots that are positive but below the threshold (negatives are handled separately)
  const cheapSlots = rates.filter((r) => r.price_inc_vat > 0 && r.price_inc_vat < threshold);
  if (cheapSlots.length === 0) return [];

  cheapSlots.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(cheapSlots);
}

export function findPreDischargeSlots(
  rates: AgileRate[],
  negativeWindows: ChargeWindow[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_price_pre_discharge !== 'true') return [];
  if (negativeWindows.length === 0) return [];

  const rateMap = new Map(rates.map((r) => [toSlotKey(r.valid_from), r]));
  const dischargeSlots: AgileRate[] = [];

  for (const window of negativeWindows) {
    // Find the 30-min slot immediately before this negative window
    const windowStart = new Date(window.slot_start);
    const preSlotStart = new Date(windowStart.getTime() - 30 * 60 * 1000);

    const preRate = rateMap.get(toSlotKey(preSlotStart));

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

export function findNegativeRunDischargeSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_run_discharge !== 'true') return [];
  if (settings.negative_price_charging !== 'true') return [];

  const slotsForFullCharge = calculateSlotsNeeded(0, 100, settings);
  if (slotsForFullCharge <= 0) return [];

  const negativeSlots = rates
    .filter((r) => r.price_inc_vat < 0)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  if (negativeSlots.length === 0) return [];

  // Group into contiguous runs
  const runs: AgileRate[][] = [];
  let currentRun: AgileRate[] = [negativeSlots[0]];

  for (let i = 1; i < negativeSlots.length; i++) {
    const prev = currentRun[currentRun.length - 1];
    if (prev.valid_to === negativeSlots[i].valid_from) {
      currentRun.push(negativeSlots[i]);
    } else {
      runs.push(currentRun);
      currentRun = [negativeSlots[i]];
    }
  }
  runs.push(currentRun);

  // For runs longer than slotsForFullCharge, discharge the leading slots
  const dischargeSlots: AgileRate[] = [];
  for (const run of runs) {
    if (run.length > slotsForFullCharge) {
      // Trailing slotsForFullCharge remain as charge (handled by findNegativePriceSlots)
      // Leading slots become discharge
      const dischargeCount = run.length - slotsForFullCharge;
      for (let i = 0; i < dischargeCount; i++) {
        dischargeSlots.push(run[i]);
      }
    }
  }

  if (dischargeSlots.length === 0) return [];
  return mergeAdjacentSlots(dischargeSlots, 'discharge');
}
