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

    expect(forecast).toEqual([{ start: 50, end: 50 }]);
  });

  it('clamps discharge at socFloor instead of 0', () => {
    // 500W consumption over 0.5h = 250Wh drain per slot → 5% of 5000Wh battery
    // Starting at 22%, two discharge slots should drain to 12% without floor,
    // but with a 20% floor the SOC should clamp at 20%.
    const forecast = computeSOCForecast({
      currentSOC: 22,
      currentSlotIndex: 0,
      slotActions: new Map([
        [0, 'discharge'],
        [1, 'discharge'],
      ]),
      totalSlots: 2,
      chargeRatePercent: 100,
      batteryCapacityWh: 5_000,
      maxChargePowerW: 3_000,
      estimatedConsumptionW: 500,
      socFloor: 20,
    });

    expect(forecast[0].end).toBe(20);
    expect(forecast[1].end).toBe(20);
  });

  it('holds SOC flat when starting below the floor in a discharge slot', () => {
    // Inverter refuses to discharge below the configured floor, so a discharge
    // slot entered at SOC 16% with a 20% floor should stay at 16% — not be
    // clamped upward to the floor (regression for the "discharge → SOC goes
    // up" bug).
    const forecast = computeSOCForecast({
      currentSOC: 16,
      currentSlotIndex: 0,
      slotActions: new Map([[0, 'discharge']]),
      totalSlots: 1,
      chargeRatePercent: 100,
      batteryCapacityWh: 5_000,
      maxChargePowerW: 3_000,
      estimatedConsumptionW: 500,
      socFloor: 20,
    });

    expect(forecast[0]).toEqual({ start: 16, end: 16 });
  });

  it('allows discharge below floor when socFloor is not set', () => {
    const forecast = computeSOCForecast({
      currentSOC: 5,
      currentSlotIndex: 0,
      slotActions: new Map([[0, 'discharge']]),
      totalSlots: 1,
      chargeRatePercent: 100,
      batteryCapacityWh: 5_000,
      maxChargePowerW: 3_000,
      estimatedConsumptionW: 500,
    });

    // 5% - 5% drain = 0%
    expect(forecast[0].end).toBe(0);
  });
});
