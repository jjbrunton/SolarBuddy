export interface SOCForecastParams {
  currentSOC: number;
  currentSlotIndex: number;
  scheduledSlots: Set<number>;
  totalSlots: number;
  chargeRatePercent: number;
  batteryCapacityWh: number;
  maxChargePowerW: number;
  estimatedConsumptionW: number;
}

/**
 * Compute a predicted SOC curve across all rate slots.
 * - Charging slots: SOC increases based on charge power and battery capacity
 * - Non-charging slots: SOC decreases based on estimated consumption
 * Returns an array of SOC values (0-100) aligned to each bar index.
 */
export function computeSOCForecast(params: SOCForecastParams): number[] {
  const {
    currentSOC,
    currentSlotIndex,
    scheduledSlots,
    totalSlots,
    chargeRatePercent,
    batteryCapacityWh,
    maxChargePowerW,
    estimatedConsumptionW,
  } = params;

  if (totalSlots === 0 || batteryCapacityWh <= 0) return [];

  const effectiveChargePowerW = maxChargePowerW * (chargeRatePercent / 100);
  // Energy per 30-min slot in Wh
  const chargePerSlotWh = effectiveChargePowerW * 0.5;
  const drainPerSlotWh = estimatedConsumptionW * 0.5;

  const forecast: number[] = new Array(totalSlots);

  // Fill slots before current with null-like values (use currentSOC as flat line)
  for (let i = 0; i < currentSlotIndex && i < totalSlots; i++) {
    forecast[i] = currentSOC;
  }

  let soc = currentSOC;
  for (let i = currentSlotIndex; i < totalSlots; i++) {
    if (scheduledSlots.has(i)) {
      // Charging: add energy
      const addPercent = (chargePerSlotWh / batteryCapacityWh) * 100;
      soc = Math.min(100, soc + addPercent);
    } else {
      // Draining: subtract consumption
      const drainPercent = (drainPerSlotWh / batteryCapacityWh) * 100;
      soc = Math.max(0, soc - drainPercent);
    }
    forecast[i] = Math.round(soc * 10) / 10;
  }

  return forecast;
}
