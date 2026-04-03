import type { PVForecastSlot } from '@/lib/solcast/client';

export type PVConfidence = 'estimate' | 'estimate10' | 'estimate90';

/**
 * Align PV forecast slots to rate chart slot indices.
 *
 * Returns a Map<number, number> (slot index → watts) for computeSOCForecast's
 * perSlotPVGenerationW parameter, and an aligned array of watt values for
 * chart overlay rendering.
 */
export function alignPVForecastToSlots(
  forecasts: PVForecastSlot[],
  rateSlotValidFroms: string[],
  confidence: PVConfidence,
): { perSlotPVGenerationW: Map<number, number>; pvChartValues: (number | undefined)[] } {
  const lookup = new Map<string, PVForecastSlot>();
  for (const slot of forecasts) {
    lookup.set(slot.valid_from, slot);
  }

  const perSlotPVGenerationW = new Map<number, number>();
  const pvChartValues: (number | undefined)[] = [];

  for (let i = 0; i < rateSlotValidFroms.length; i++) {
    const pv = lookup.get(rateSlotValidFroms[i]);
    if (pv) {
      const watts =
        confidence === 'estimate10' ? pv.pv_estimate10_w
          : confidence === 'estimate90' ? pv.pv_estimate90_w
            : pv.pv_estimate_w;
      perSlotPVGenerationW.set(i, watts);
      pvChartValues.push(watts);
    } else {
      pvChartValues.push(undefined);
    }
  }

  return { perSlotPVGenerationW, pvChartValues };
}
