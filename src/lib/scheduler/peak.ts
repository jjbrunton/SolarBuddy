import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import {
  ChargeWindow,
  PlanningContext,
  calculateSlotsNeeded,
  isInChargeWindow,
  mergeAdjacentSlots,
} from './engine';

export interface DetectedPeak {
  peakStart: string; // ISO timestamp of first peak slot
  peakEnd: string;   // ISO timestamp of end of last peak slot
}

export function detectPeakPeriod(
  rates: AgileRate[],
  durationSlots: number,
  now: Date,
): DetectedPeak | null {
  const future = [...rates]
    .filter((r) => new Date(r.valid_to).getTime() > now.getTime())
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  if (future.length < durationSlots || durationSlots <= 0) return null;

  let bestSum = -Infinity;
  let bestStart = 0;

  for (let i = 0; i <= future.length - durationSlots; i++) {
    let sum = 0;
    for (let j = i; j < i + durationSlots; j++) {
      sum += future[j].price_inc_vat;
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = i;
    }
  }

  return {
    peakStart: future[bestStart].valid_from,
    peakEnd: future[bestStart + durationSlots - 1].valid_to,
  };
}

export function findPeakPrepSlots(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  if (settings.peak_protection !== 'true') return [];

  const peakSocTarget = parseFloat(settings.peak_soc_target) || 90;
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const now = context.now ?? new Date();
  const currentSoc = context.currentSoc ?? null;

  if (currentSoc === null || currentSoc >= peakSocTarget) return [];

  const slotsNeeded = calculateSlotsNeeded(currentSoc, peakSocTarget, settings);
  if (slotsNeeded <= 0) return [];

  // Resolve peak bounds: auto-detect or use manual settings
  let nextPeakSlot: AgileRate | undefined;
  let peakStart: string;
  let peakEnd: string;

  if (settings.peak_detection === 'auto') {
    const durationSlots = parseInt(settings.peak_duration_slots, 10) || 7;
    const detected = detectPeakPeriod(rates, durationSlots, now);
    if (detected) {
      // Use detected ISO timestamps directly
      nextPeakSlot = rates.find((r) => r.valid_from === detected.peakStart);
      // For eligible filtering we use the detected start/end as bounds
      peakStart = detected.peakStart;
      peakEnd = detected.peakEnd;

      if (!nextPeakSlot) return [];

      // Select slots that are: after now, before detected peak start
      const eligible = rates.filter((r) => {
        const slotEnd = new Date(r.valid_to);
        if (slotEnd.getTime() <= now.getTime()) return false;
        if (r.valid_from >= peakStart) return false;
        return true;
      });

      if (eligible.length === 0) return [];

      const sorted = [...eligible].sort((a, b) => a.price_inc_vat - b.price_inc_vat);
      const selected =
        priceThreshold > 0
          ? sorted.filter((r) => r.price_inc_vat <= priceThreshold).slice(0, slotsNeeded)
          : sorted.slice(0, slotsNeeded);

      if (selected.length === 0) return [];

      selected.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
      return mergeAdjacentSlots(selected);
    }
    // Fall through to manual if detection returns null
  }

  // Manual peak detection (default)
  peakStart = settings.peak_period_start || '16:00';
  peakEnd = settings.peak_period_end || '19:00';

  // Find the next peak period start in the rate data
  nextPeakSlot = rates.find((r) => {
    const slotEnd = new Date(r.valid_to);
    if (slotEnd.getTime() <= now.getTime()) return false;
    return isInChargeWindow(r.valid_from, peakStart, peakEnd);
  });

  if (!nextPeakSlot) return [];

  // Select slots that are: after now, before peak start, and NOT during peak
  const eligible = rates.filter((r) => {
    const slotEnd = new Date(r.valid_to);
    if (slotEnd.getTime() <= now.getTime()) return false;
    // Must be before the peak window starts
    if (r.valid_from >= nextPeakSlot!.valid_from) return false;
    // Must not be inside the peak window itself
    if (isInChargeWindow(r.valid_from, peakStart, peakEnd)) return false;
    return true;
  });

  if (eligible.length === 0) return [];

  const sorted = [...eligible].sort((a, b) => a.price_inc_vat - b.price_inc_vat);
  const selected =
    priceThreshold > 0
      ? sorted.filter((r) => r.price_inc_vat <= priceThreshold).slice(0, slotsNeeded)
      : sorted.slice(0, slotsNeeded);

  if (selected.length === 0) return [];

  selected.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(selected);
}
