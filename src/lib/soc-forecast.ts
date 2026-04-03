import type { PlanAction } from './plan-actions';

export interface SOCForecastParams {
  currentSOC: number;
  currentSlotIndex: number;
  /** Map from slot index to action. Slots not in the map default to 'do_nothing'. */
  slotActions: Map<number, PlanAction>;
  totalSlots: number;
  chargeRatePercent: number;
  batteryCapacityWh: number;
  maxChargePowerW: number;
  estimatedConsumptionW: number;
  /** Optional PV forecast: map from slot index to expected PV generation in watts. */
  perSlotPVGenerationW?: Map<number, number>;
}

/**
 * Compute a predicted SOC curve across all rate slots.
 * - charge: SOC increases based on charge power
 * - discharge: SOC decreases at charge power rate + consumption
 * - hold: SOC stays flat because the inverter is actively preventing discharge
 * - do_nothing: legacy idle state, decreases based on estimated consumption
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
  } = params;

  if (totalSlots === 0 || batteryCapacityWh <= 0) return [];

  const effectiveChargePowerW = maxChargePowerW * (chargeRatePercent / 100);
  const chargePerSlotWh = effectiveChargePowerW * 0.5;
  const drainPerSlotWh = estimatedConsumptionW * 0.5;

  const forecast: number[] = new Array(totalSlots);

  for (let i = 0; i < currentSlotIndex && i < totalSlots; i++) {
    forecast[i] = currentSOC;
  }

  let soc = currentSOC;
  for (let i = currentSlotIndex; i < totalSlots; i++) {
    const action = slotActions.get(i) ?? 'do_nothing';
    const pvWh = (perSlotPVGenerationW?.get(i) ?? 0) * 0.5;

    switch (action) {
      case 'charge': {
        // Grid charging at configured rate; PV surplus is additive
        const addWh = chargePerSlotWh + Math.max(0, pvWh - drainPerSlotWh);
        const addPercent = (addWh / batteryCapacityWh) * 100;
        soc = Math.min(100, soc + addPercent);
        break;
      }
      case 'discharge': {
        // PV reduces the effective discharge needed to cover load
        const effectiveDischargeWh = Math.max(0, (chargePerSlotWh + drainPerSlotWh) - pvWh);
        const dischargePercent = (effectiveDischargeWh / batteryCapacityWh) * 100;
        soc = Math.max(0, soc - dischargePercent);
        break;
      }
      case 'hold': {
        // Hold prevents grid discharge; PV surplus still charges battery
        if (pvWh > drainPerSlotWh) {
          const surplusWh = pvWh - drainPerSlotWh;
          const addPercent = (surplusWh / batteryCapacityWh) * 100;
          soc = Math.min(100, soc + addPercent);
        }
        break;
      }
      case 'do_nothing':
      default: {
        // PV offsets consumption; surplus charges battery
        const netDrainWh = drainPerSlotWh - pvWh;
        if (netDrainWh > 0) {
          const drainPercent = (netDrainWh / batteryCapacityWh) * 100;
          soc = Math.max(0, soc - drainPercent);
        } else {
          const surplusWh = -netDrainWh;
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
