import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import {
  ChargeWindow,
  PlanningContext,
  calculateSlotsNeeded,
  isInChargeWindow,
  mergeAdjacentSlots,
} from './engine';

export function findPeakPrepSlots(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  if (settings.peak_protection !== 'true') return [];

  const peakStart = settings.peak_period_start || '16:00';
  const peakEnd = settings.peak_period_end || '19:00';
  const peakSocTarget = parseFloat(settings.peak_soc_target) || 90;
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const now = context.now ?? new Date();
  const currentSoc = context.currentSoc ?? null;

  if (currentSoc === null || currentSoc >= peakSocTarget) return [];

  const slotsNeeded = calculateSlotsNeeded(currentSoc, peakSocTarget, settings);
  if (slotsNeeded <= 0) return [];

  // Find the next peak period start in the rate data
  const nextPeakSlot = rates.find((r) => {
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
    if (r.valid_from >= nextPeakSlot.valid_from) return false;
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
