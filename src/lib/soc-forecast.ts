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
}

/**
 * Compute a predicted SOC curve across all rate slots.
 * - charge: SOC increases based on charge power
 * - discharge: SOC decreases at charge power rate + consumption
 * - hold: SOC stays flat (inverter maintains level)
 * - do_nothing: SOC decreases based on estimated consumption
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

    switch (action) {
      case 'charge': {
        const addPercent = (chargePerSlotWh / batteryCapacityWh) * 100;
        soc = Math.min(100, soc + addPercent);
        break;
      }
      case 'discharge': {
        const dischargePercent = ((chargePerSlotWh + drainPerSlotWh) / batteryCapacityWh) * 100;
        soc = Math.max(0, soc - dischargePercent);
        break;
      }
      case 'hold':
        // Battery level maintained by inverter
        break;
      case 'do_nothing':
      default: {
        const drainPercent = (drainPerSlotWh / batteryCapacityWh) * 100;
        soc = Math.max(0, soc - drainPercent);
        break;
      }
    }
    forecast[i] = Math.round(soc * 10) / 10;
  }

  return forecast;
}
