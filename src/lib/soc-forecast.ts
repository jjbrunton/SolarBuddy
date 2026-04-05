import type { PlanAction } from './plan-actions';

export interface SOCForecastParams {
  currentSOC: number;
  currentSlotIndex: number;
  /** Map from slot index to action. Slots not in the map default to 'hold'. */
  slotActions: Map<number, PlanAction>;
  totalSlots: number;
  chargeRatePercent: number;
  batteryCapacityWh: number;
  maxChargePowerW: number;
  estimatedConsumptionW: number;
  /** Optional PV forecast: map from slot index to expected PV generation in watts. */
  perSlotPVGenerationW?: Map<number, number>;
  /**
   * Optional per-slot consumption lookup (Watts). When provided, overrides the
   * flat `estimatedConsumptionW` for drain calculations. The caller is responsible
   * for translating slot indices to wall-clock time before querying the usage
   * profile. Callers that pass this should still set `estimatedConsumptionW` as
   * a sensible scalar fallback.
   */
  drainWAtSlot?: (slotIndex: number) => number;
  /** Optional starting SOC and index for modelling from an earlier slot than currentSlotIndex. */
  startSOC?: number;
  startIndex?: number;
}

/**
 * Compute a predicted SOC curve across all rate slots.
 * - charge: SOC increases based on charge power
 * - discharge: SOC decreases at charge power rate + consumption
 * - hold: SOC stays flat because the inverter is actively preventing discharge;
 *   PV surplus (above home consumption) can still charge the battery
 * Returns an array of SOC values (0-100) aligned to each bar index.
 */
export function computeSOCForecast(params: SOCForecastParams): number[] {
  const {
    currentSOC,
    currentSlotIndex,
    slotActions,
    totalSlots,
    chargeRatePercent,
    batteryCapacityWh,
    maxChargePowerW,
    estimatedConsumptionW,
    perSlotPVGenerationW,
    drainWAtSlot,
    startSOC,
    startIndex: paramStartIndex,
  } = params;

  if (totalSlots === 0 || batteryCapacityWh <= 0) return [];

  const effectiveChargePowerW = maxChargePowerW * (chargeRatePercent / 100);
  const chargePerSlotWh = effectiveChargePowerW * 0.5;
  const fallbackDrainPerSlotWh = estimatedConsumptionW * 0.5;
  const drainWhForSlot = (slotIndex: number): number =>
    drainWAtSlot ? drainWAtSlot(slotIndex) * 0.5 : fallbackDrainPerSlotWh;

  const forecast: number[] = new Array(totalSlots);
  const hasStart = startSOC != null && paramStartIndex != null;
  const modelStart = hasStart ? paramStartIndex : currentSlotIndex;

  // Fill slots before the model start with the starting SOC
  const fillSOC = hasStart ? startSOC : currentSOC;
  for (let i = 0; i < modelStart && i < totalSlots; i++) {
    forecast[i] = fillSOC;
  }

  let soc = fillSOC;
  for (let i = modelStart; i < totalSlots; i++) {
    const action: PlanAction = slotActions.get(i) ?? 'hold';
    const pvWh = (perSlotPVGenerationW?.get(i) ?? 0) * 0.5;
    const drainPerSlotWh = drainWhForSlot(i);

    switch (action) {
      case 'charge': {
        // Grid charging at configured rate; PV surplus is additive
        const addWh = chargePerSlotWh + Math.max(0, pvWh - drainPerSlotWh);
        const addPercent = (addWh / batteryCapacityWh) * 100;
        soc = Math.min(100, soc + addPercent);
        break;
      }
      case 'discharge': {
        // Load-following: battery only covers consumption minus PV
        if (pvWh >= drainPerSlotWh) {
          // PV covers all consumption; surplus charges battery
          const surplusWh = pvWh - drainPerSlotWh;
          const addPercent = (surplusWh / batteryCapacityWh) * 100;
          soc = Math.min(100, soc + addPercent);
        } else {
          const netDrainWh = drainPerSlotWh - pvWh;
          const drainPercent = (netDrainWh / batteryCapacityWh) * 100;
          soc = Math.max(0, soc - drainPercent);
        }
        break;
      }
      case 'hold': {
        // Hold prevents battery discharge (home load comes from grid);
        // PV surplus (after covering consumption) still charges battery.
        if (pvWh > drainPerSlotWh) {
          const surplusWh = pvWh - drainPerSlotWh;
          const addPercent = (surplusWh / batteryCapacityWh) * 100;
          soc = Math.min(100, soc + addPercent);
        }
        break;
      }
    }
    forecast[i] = Math.round(soc * 10) / 10;
  }

  return forecast;
}
