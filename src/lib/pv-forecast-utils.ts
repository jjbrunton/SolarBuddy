import type { PVForecastSlot } from '@/lib/solcast/client';
import { toSlotKey } from '@/lib/slot-key';

export type PVConfidence = 'estimate' | 'estimate10' | 'estimate90';

const HALF_HOUR_MS = 30 * 60 * 1000;

/**
 * Snap an arbitrary instant to the half-hour rate slot that contains it.
 *
 * Forecast providers (e.g. forecast.solar) can emit slots that are 30 minutes
 * long but phase-shifted relative to the electricity tariff clock (e.g. a slot
 * starting at 05:35:12). This helper returns the canonical rate-slot key
 * (`toSlotKey`-normalised) whose [start, start+30m) window covers the given
 * midpoint, so forecast slots can be attributed to the rate slot they mostly
 * overlap.
 */
function canonicalHalfHourKey(iso: string): string {
  const t = new Date(iso).getTime();
  const midpoint = t + HALF_HOUR_MS / 2;
  const floored = Math.floor(midpoint / HALF_HOUR_MS) * HALF_HOUR_MS;
  return toSlotKey(new Date(floored).toISOString());
}

function pickWatts(slot: PVForecastSlot, confidence: PVConfidence): number {
  return confidence === 'estimate10'
    ? slot.pv_estimate10_w
    : confidence === 'estimate90'
      ? slot.pv_estimate90_w
      : slot.pv_estimate_w;
}

/**
 * Align PV forecast slots to rate chart slot indices.
 *
 * Returns a Map<number, number> (slot index → watts) for computeSOCForecast's
 * perSlotPVGenerationW parameter, and an aligned array of watt values for
 * chart overlay rendering.
 *
 * Matching is tolerant of phase-shifted forecast slots: each forecast slot is
 * snapped to the half-hour rate slot its midpoint falls into, so forecasts
 * that start at e.g. 05:35:12 are correctly attributed to the 05:30 rate slot.
 * If multiple forecast slots map to the same rate slot (rare; only when
 * forecasts are shorter than 30 min), the latest one wins.
 */
export function alignPVForecastToSlots(
  forecasts: PVForecastSlot[],
  rateSlotValidFroms: string[],
  confidence: PVConfidence,
): { perSlotPVGenerationW: Map<number, number>; pvChartValues: (number | undefined)[] } {
  const lookup = new Map<string, number>();
  for (const slot of forecasts) {
    lookup.set(canonicalHalfHourKey(slot.valid_from), pickWatts(slot, confidence));
  }

  const perSlotPVGenerationW = new Map<number, number>();
  const pvChartValues: (number | undefined)[] = [];

  for (let i = 0; i < rateSlotValidFroms.length; i++) {
    const key = toSlotKey(rateSlotValidFroms[i]);
    const watts = lookup.get(key);
    if (watts != null) {
      perSlotPVGenerationW.set(i, watts);
      pvChartValues.push(watts);
    } else {
      pvChartValues.push(undefined);
    }
  }

  return { perSlotPVGenerationW, pvChartValues };
}
