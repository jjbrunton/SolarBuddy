import { describe, expect, it } from 'vitest';
import { computeSOCForecast } from '../soc-forecast';

describe('computeSOCForecast', () => {
  it('treats hold slots as an explicit battery-preservation state', () => {
    const forecast = computeSOCForecast({
      currentSOC: 50,
      currentSlotIndex: 0,
      slotActions: new Map([[0, 'hold']]),
      totalSlots: 1,
      chargeRatePercent: 100,
      batteryCapacityWh: 5_000,
      maxChargePowerW: 3_000,
      estimatedConsumptionW: 500,
    });

    expect(forecast).toEqual([50]);
  });
});
