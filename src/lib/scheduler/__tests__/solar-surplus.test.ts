import { describe, expect, it } from 'vitest';
import { canReachTargetWithPessimisticSolar, shouldHoldForSolarSurplus } from '../solar-surplus';

describe('shouldHoldForSolarSurplus', () => {
  it('returns true when the site is exporting or charging without importing', () => {
    expect(
      shouldHoldForSolarSurplus({
        pv_power: 1400,
        load_power: 500,
        grid_power: -200,
        battery_power: 100,
      }),
    ).toBe(true);
  });

  it('returns false when the battery needs grid support', () => {
    expect(
      shouldHoldForSolarSurplus({
        pv_power: 200,
        load_power: 900,
        grid_power: 700,
        battery_power: 0,
      }),
    ).toBe(false);
  });
});

describe('canReachTargetWithPessimisticSolar', () => {
  const fourSlots = [
    { slot_start: '2026-04-01T10:00:00Z', slot_end: '2026-04-01T10:30:00Z' },
    { slot_start: '2026-04-01T10:30:00Z', slot_end: '2026-04-01T11:00:00Z' },
    { slot_start: '2026-04-01T11:00:00Z', slot_end: '2026-04-01T11:30:00Z' },
    { slot_start: '2026-04-01T11:30:00Z', slot_end: '2026-04-01T12:00:00Z' },
  ];

  const forecast = (p10W: number) =>
    fourSlots.map((slot) => ({ valid_from: slot.slot_start, pv_estimate10_w: p10W }));

  it('returns true when already at target', () => {
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 85,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(3000),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(true);
  });

  it('returns true when P10 solar comfortably covers the deficit', () => {
    // Deficit 20pp × 5.12 kWh = 1.024 kWh. 4 slots × (3000W - 400W) × 0.5h = 5.2 kWh.
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(3000),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(true);
  });

  it('returns false when P10 solar is too low to cover the deficit', () => {
    // 4 slots × max(0, 500W - 400W) × 0.5h = 0.2 kWh. Deficit 1.024 kWh.
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(500),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(false);
  });

  it('returns false when forecast is stale beyond the threshold', () => {
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(3000),
        forecastAgeMinutes: 24 * 60,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(false);
  });

  it('returns false when no forecast rows are provided', () => {
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: [],
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(false);
  });

  it('returns false when remaining slots is empty', () => {
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: [],
        forecast: forecast(3000),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(false);
  });

  it('returns false when current SOC is unknown', () => {
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: null,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(3000),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
      }),
    ).toBe(false);
  });

  it('applies the PV damp factor before comparing to deficit', () => {
    // Without damping, 4 × (1200W - 400W) × 0.5h = 1.6 kWh covers the 1.024 kWh deficit.
    // With a 0.5 damp factor, P10 effectively becomes 600W — below load, so net 0.
    expect(
      canReachTargetWithPessimisticSolar({
        currentSoc: 60,
        targetSoc: 80,
        batteryCapacityKwh: 5.12,
        remainingSlots: fourSlots,
        forecast: forecast(1200),
        forecastAgeMinutes: 30,
        expectedLoadAtW: () => 400,
        dampFactor: 0.5,
      }),
    ).toBe(false);
  });
});
