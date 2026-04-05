import { describe, expect, it } from 'vitest';
import {
  buildSchedulePlan,
  findCheapestSlots,
  findDroppingChargeKeys,
  findSuppressedPreCheapestKeys,
  shouldSkipOvernightCharge,
} from '../engine';
import type { AgileRate } from '../../octopus/rates';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';

const baseSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  octopus_region: 'H',
};

function rate(valid_from: string, valid_to: string, price_inc_vat: number): AgileRate {
  return {
    valid_from,
    valid_to,
    price_inc_vat,
    price_exc_vat: price_inc_vat,
  };
}

describe('findCheapestSlots', () => {
  it('treats 22:00Z as 23:00 local during BST for overnight windows', () => {
    const rates = [
      rate('2026-03-30T21:30:00Z', '2026-03-30T22:00:00Z', 12),
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 1),
      rate('2026-03-30T22:30:00Z', '2026-03-30T23:00:00Z', 2),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charge_hours: '2',
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      slot_start: '2026-03-30T22:00:00Z',
      slot_end: '2026-03-30T23:00:00Z',
    });
  });

  it('excludes 06:30Z because it is 07:30 local and outside the overnight window', () => {
    const rates = [
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 5),
      rate('2026-03-31T05:30:00Z', '2026-03-31T06:00:00Z', 6),
      rate('2026-03-31T06:30:00Z', '2026-03-31T07:00:00Z', -10),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charge_hours: '1',
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].slot_start).toBe('2026-03-30T22:00:00Z');
    expect(windows[0].avg_price).toBe(5);
  });

  it('uses only the slots needed to reach the target SOC when telemetry is available', () => {
    const rates = [
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 12),
      rate('2026-03-30T22:30:00Z', '2026-03-30T23:00:00Z', 2),
      rate('2026-03-30T23:00:00Z', '2026-03-30T23:30:00Z', 1),
      rate('2026-03-30T23:30:00Z', '2026-03-31T00:00:00Z', 5),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charge_hours: '4',
      battery_capacity_kwh: '5',
      max_charge_power_kw: '2',
      charge_rate: '100',
      min_soc_target: '80',
    }, {
      currentSoc: 50,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      slot_start: '2026-03-30T22:30:00Z',
      slot_end: '2026-03-30T23:30:00Z',
    });
  });

  it('uses the current tariff horizon instead of the overnight window for opportunistic top-up', () => {
    const rates = [
      rate('2026-03-30T10:30:00Z', '2026-03-30T11:00:00Z', -5),
      rate('2026-03-30T11:00:00Z', '2026-03-30T11:30:00Z', 1),
      rate('2026-03-30T12:00:00Z', '2026-03-30T12:30:00Z', 8),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charging_strategy: 'opportunistic_topup',
      charge_window_start: '23:00',
      charge_window_end: '07:00',
      battery_capacity_kwh: '5',
      max_charge_power_kw: '2',
      charge_rate: '100',
      min_soc_target: '50',
    }, {
      currentSoc: 40,
      now: new Date('2026-03-30T11:05:00Z'),
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      slot_start: '2026-03-30T11:00:00Z',
      slot_end: '2026-03-30T11:30:00Z',
      avg_price: 1,
    });
  });
});

describe('buildSchedulePlan', () => {
  it('emits hold slots when preserving battery for a later planned discharge', () => {
    const rates = [
      rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 8),
      rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', 12),
      rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 45),
    ];

    const plan = buildSchedulePlan(rates, {
      ...baseSettings,
      charging_strategy: 'opportunistic_topup',
      smart_discharge: 'true',
      discharge_price_threshold: '40',
      estimated_consumption_w: '500',
      min_soc_target: '0',
    }, {
      currentSoc: 60,
      now: new Date('2026-04-01T09:55:00Z'),
    });

    expect(plan.slots.map((slot) => slot.action)).toEqual(['hold', 'hold', 'discharge']);
    expect(plan.slots[0].reason).toContain('Hold battery');
  });

  it('returns slot-level reasons and expected SOC values for the planned actions', () => {
    const rates = [
      rate('2026-04-01T22:00:00Z', '2026-04-01T22:30:00Z', 4),
      rate('2026-04-01T22:30:00Z', '2026-04-01T23:00:00Z', 5),
      rate('2026-04-01T23:00:00Z', '2026-04-01T23:30:00Z', 42),
    ];

    const plan = buildSchedulePlan(rates, {
      ...baseSettings,
      charging_strategy: 'opportunistic_topup',
      smart_discharge: 'true',
      discharge_price_threshold: '40',
      min_soc_target: '50',
      charge_hours: '2',
      estimated_consumption_w: '500',
    }, {
      currentSoc: 40,
      now: new Date('2026-04-01T21:55:00Z'),
    });

    expect(plan.slots[0]).toMatchObject({
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    });
    expect(plan.slots[1]).toMatchObject({
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    });
    expect(plan.slots[2]).toMatchObject({
      action: 'discharge',
      reason: 'Discharge slot selected by the arbitrage planner.',
    });
    expect(plan.slots.every((slot) => slot.expected_soc_after !== null)).toBe(true);
  });
});

describe('buildSchedulePlan negative run discharge', () => {
  // slotsForFullCharge = ceil(5 / (2.5 * 0.5)) = 4
  const longRunSettings = {
    negative_price_charging: 'true',
    negative_run_discharge: 'true',
    battery_capacity_kwh: '5',
    max_charge_power_kw: '2.5',
    charge_rate: '100',
    estimated_consumption_w: '500',
    discharge_soc_floor: '20',
  };

  const longNegativeRun = [
    rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', -1),
    rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', -2),
    rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -3),
    rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', -4),
    rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', -5),
    rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', -6),
  ];

  it('discharges leading slots and charges trailing slots over a long negative run', () => {
    const plan = buildSchedulePlan(longNegativeRun, {
      ...baseSettings,
      ...longRunSettings,
      smart_discharge: 'true',
      charge_hours: '4',
      min_soc_target: '100',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T00:30:00Z'),
    });

    const actions = plan.slots.map((slot) => slot.action);
    expect(actions).toEqual(['discharge', 'discharge', 'charge', 'charge', 'charge', 'charge']);

    expect(plan.slots[0].reason).toContain('Discharge during extended negative-price run');
    expect(plan.slots[1].reason).toContain('Discharge during extended negative-price run');
    expect(plan.slots[2].reason).toBe('Negative-price charge slot.');

    // SOC forecast reflects the discharge-then-charge cycle
    const socs = plan.slots.map((slot) => slot.expected_soc_after);
    expect(socs[0]).not.toBeNull();
    expect(socs[0]!).toBeLessThan(80);
    expect(socs[1]!).toBeLessThan(socs[0]!);
    expect(socs[2]!).toBeGreaterThan(socs[1]!);
  });

  it('keeps the discharge classification when findCheapestSlots would also select a leading slot', () => {
    // Leading slots are the cheapest in the horizon, so findCheapestSlots
    // will pick them too. Without the baseWindows filter fix, deduplicateAndMerge
    // would demote them back to charge.
    const biasedRun = [
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', -10),
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', -9),
      rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -1),
      rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', -2),
      rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', -3),
      rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', -4),
    ];

    const plan = buildSchedulePlan(biasedRun, {
      ...baseSettings,
      ...longRunSettings,
      charging_strategy: 'opportunistic_topup',
      charge_hours: '2',
      min_soc_target: '100',
    }, {
      currentSoc: 50,
      now: new Date('2026-04-01T00:30:00Z'),
    });

    expect(plan.slots[0].action).toBe('discharge');
    expect(plan.slots[1].action).toBe('discharge');
    expect(plan.slots[0].reason).toContain('Discharge during extended negative-price run');
  });

  it('leaves short negative runs unchanged as charge slots', () => {
    const shortRun = [
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', -1),
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', -2),
    ];

    const plan = buildSchedulePlan(shortRun, {
      ...baseSettings,
      ...longRunSettings,
      min_soc_target: '100',
    }, {
      currentSoc: 50,
      now: new Date('2026-04-01T00:30:00Z'),
    });

    const actions = plan.slots.map((slot) => slot.action);
    expect(actions).not.toContain('discharge');
    expect(actions.filter((action) => action === 'charge')).toHaveLength(2);
  });

  it('preserves pre-discharge before a long negative run when both flags are enabled', () => {
    const ratesWithPreSlot = [
      rate('2026-04-01T00:30:00Z', '2026-04-01T01:00:00Z', 10),
      ...longNegativeRun,
    ];

    const plan = buildSchedulePlan(ratesWithPreSlot, {
      ...baseSettings,
      ...longRunSettings,
      negative_price_pre_discharge: 'true',
      charge_hours: '4',
      min_soc_target: '100',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T00:25:00Z'),
    });

    expect(plan.slots[0].action).toBe('discharge');
    expect(plan.slots[0].reason).toBe('Pre-discharge slot reserved before a negative-price charging window.');
    expect(plan.slots[1].action).toBe('discharge');
    expect(plan.slots[1].reason).toContain('Discharge during extended negative-price run');
    expect(plan.slots[2].action).toBe('discharge');
    expect(plan.slots[2].reason).toContain('Discharge during extended negative-price run');
    expect(plan.slots[3].action).toBe('charge');
  });
});

describe('findSuppressedPreCheapestKeys', () => {
  it('returns empty when disabled', () => {
    const windows = findCheapestSlots([
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 2),
    ], baseSettings);
    const suppressed = findSuppressedPreCheapestKeys(windows, [], baseSettings);
    expect(suppressed.size).toBe(0);
  });

  it('suppresses slots before the cheapest block', () => {
    const rates = [
      rate('2026-03-30T20:00:00Z', '2026-03-30T20:30:00Z', 15),
      rate('2026-03-30T20:30:00Z', '2026-03-30T21:00:00Z', 12),
      rate('2026-03-30T21:00:00Z', '2026-03-30T21:30:00Z', 10),
      rate('2026-03-30T21:30:00Z', '2026-03-30T22:00:00Z', 8),
      // Cheapest block starts here
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 1),
      rate('2026-03-30T22:30:00Z', '2026-03-30T23:00:00Z', 2),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charge_hours: '2',
    });

    const suppressed = findSuppressedPreCheapestKeys(windows, rates, {
      ...baseSettings,
      pre_cheapest_suppression: 'true',
      battery_capacity_kwh: '2',
      max_charge_power_kw: '2',
      charge_rate: '100',
    });

    // slotsForFullCharge = ceil(2 / (2*0.5)) = 2
    // Should suppress 2 slots before 22:00 (21:00 and 21:30)
    expect(suppressed.has('2026-03-30T21:00:00Z')).toBe(true);
    expect(suppressed.has('2026-03-30T21:30:00Z')).toBe(true);
    // Should NOT suppress the charge slots themselves
    expect(suppressed.has('2026-03-30T22:00:00Z')).toBe(false);
  });

  it('does not suppress base charge slots', () => {
    const rates = [
      rate('2026-03-30T22:00:00Z', '2026-03-30T22:30:00Z', 1),
      rate('2026-03-30T22:30:00Z', '2026-03-30T23:00:00Z', 2),
    ];

    const windows = findCheapestSlots(rates, {
      ...baseSettings,
      charge_hours: '2',
    });

    const suppressed = findSuppressedPreCheapestKeys(windows, rates, {
      ...baseSettings,
      pre_cheapest_suppression: 'true',
    });

    // No slots before the first charge slot to suppress
    expect(suppressed.size).toBe(0);
  });
});

describe('shouldSkipOvernightCharge', () => {
  const now = new Date('2026-04-01T20:00:00Z');

  const highSolarForecast = [
    // Tomorrow (2026-04-02) has lots of sun
    { valid_from: '2026-04-02T06:00:00Z', valid_to: '2026-04-02T06:30:00Z', pv_estimate_w: 2000, pv_estimate10_w: 1000, pv_estimate90_w: 3000 },
    { valid_from: '2026-04-02T06:30:00Z', valid_to: '2026-04-02T07:00:00Z', pv_estimate_w: 3000, pv_estimate10_w: 2000, pv_estimate90_w: 4000 },
    { valid_from: '2026-04-02T07:00:00Z', valid_to: '2026-04-02T07:30:00Z', pv_estimate_w: 4000, pv_estimate10_w: 3000, pv_estimate90_w: 5000 },
    { valid_from: '2026-04-02T07:30:00Z', valid_to: '2026-04-02T08:00:00Z', pv_estimate_w: 4000, pv_estimate10_w: 3000, pv_estimate90_w: 5000 },
    { valid_from: '2026-04-02T08:00:00Z', valid_to: '2026-04-02T08:30:00Z', pv_estimate_w: 4500, pv_estimate10_w: 3500, pv_estimate90_w: 5500 },
    { valid_from: '2026-04-02T08:30:00Z', valid_to: '2026-04-02T09:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
    { valid_from: '2026-04-02T09:00:00Z', valid_to: '2026-04-02T09:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
    { valid_from: '2026-04-02T09:30:00Z', valid_to: '2026-04-02T10:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
    { valid_from: '2026-04-02T10:00:00Z', valid_to: '2026-04-02T10:30:00Z', pv_estimate_w: 4500, pv_estimate10_w: 3500, pv_estimate90_w: 5500 },
    { valid_from: '2026-04-02T10:30:00Z', valid_to: '2026-04-02T11:00:00Z', pv_estimate_w: 4000, pv_estimate10_w: 3000, pv_estimate90_w: 5000 },
    { valid_from: '2026-04-02T11:00:00Z', valid_to: '2026-04-02T11:30:00Z', pv_estimate_w: 3000, pv_estimate10_w: 2000, pv_estimate90_w: 4000 },
    { valid_from: '2026-04-02T11:30:00Z', valid_to: '2026-04-02T12:00:00Z', pv_estimate_w: 2000, pv_estimate10_w: 1000, pv_estimate90_w: 3000 },
  ];
  // Total: (2000+3000+4000+4000+4500+5000+5000+5000+4500+4000+3000+2000) * 0.5 / 1000 = 23 kWh

  it('returns false when disabled', () => {
    expect(shouldSkipOvernightCharge(highSolarForecast, {
      ...baseSettings,
      solar_skip_enabled: 'false',
      pv_forecast_enabled: 'true',
    }, now)).toBe(false);
  });

  it('returns false when PV forecast not enabled', () => {
    expect(shouldSkipOvernightCharge(highSolarForecast, {
      ...baseSettings,
      solar_skip_enabled: 'true',
      pv_forecast_enabled: 'false',
    }, now)).toBe(false);
  });

  it('returns false when no forecast data', () => {
    expect(shouldSkipOvernightCharge([], {
      ...baseSettings,
      solar_skip_enabled: 'true',
      pv_forecast_enabled: 'true',
    }, now)).toBe(false);
  });

  it('returns true when next-day total exceeds threshold', () => {
    expect(shouldSkipOvernightCharge(highSolarForecast, {
      ...baseSettings,
      solar_skip_enabled: 'true',
      pv_forecast_enabled: 'true',
      solar_skip_threshold_kwh: '15',
    }, now)).toBe(true);
  });

  it('returns false when next-day total is below threshold', () => {
    expect(shouldSkipOvernightCharge(highSolarForecast, {
      ...baseSettings,
      solar_skip_enabled: 'true',
      pv_forecast_enabled: 'true',
      solar_skip_threshold_kwh: '30',
    }, now)).toBe(false);
  });

  it('applies pv_forecast_damp_factor to the summed forecast before comparing to threshold', () => {
    // Build a forecast that sums to ~30 kWh for tomorrow.
    // 30 kWh * 2 slots/hour * 1000 = 60,000 W-slot total; per slot average = 5000 W across 12 slots
    const forecast = [
      { valid_from: '2026-04-02T06:00:00Z', valid_to: '2026-04-02T06:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T06:30:00Z', valid_to: '2026-04-02T07:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T07:00:00Z', valid_to: '2026-04-02T07:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T07:30:00Z', valid_to: '2026-04-02T08:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T08:00:00Z', valid_to: '2026-04-02T08:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T08:30:00Z', valid_to: '2026-04-02T09:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T09:00:00Z', valid_to: '2026-04-02T09:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T09:30:00Z', valid_to: '2026-04-02T10:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T10:00:00Z', valid_to: '2026-04-02T10:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T10:30:00Z', valid_to: '2026-04-02T11:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T11:00:00Z', valid_to: '2026-04-02T11:30:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
      { valid_from: '2026-04-02T11:30:00Z', valid_to: '2026-04-02T12:00:00Z', pv_estimate_w: 5000, pv_estimate10_w: 4000, pv_estimate90_w: 6000 },
    ];
    // raw total = 12 slots * 5000 W * 0.5h / 1000 = 30 kWh

    const base = {
      ...baseSettings,
      solar_skip_enabled: 'true',
      pv_forecast_enabled: 'true',
      solar_skip_threshold_kwh: '20',
    };

    // Undamped: 30 kWh > 20 threshold → skip
    expect(shouldSkipOvernightCharge(forecast, { ...base, pv_forecast_damp_factor: '1.0' }, now)).toBe(true);

    // Damped to 50%: 15 kWh < 20 threshold → don't skip
    expect(shouldSkipOvernightCharge(forecast, { ...base, pv_forecast_damp_factor: '0.5' }, now)).toBe(false);
  });
});

describe('findDroppingChargeKeys', () => {
  const droppingNow = new Date('2026-04-01T09:55:00Z');
  const droppingRates = [
    rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 15),
    rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', 14),
    rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 25),
    rate('2026-04-01T11:30:00Z', '2026-04-01T12:00:00Z', 30),
    rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', 5),
    rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', 6),
  ];
  // Unlimited budget + no threshold → mean-below-avg: mean≈15.83, so
  // selected slots are 15, 14, 5, 6 (four base-charge slots).

  const droppingSettings: AppSettings = {
    ...baseSettings,
    charging_strategy: 'opportunistic_topup',
    charge_hours: '0',
    price_threshold: '0',
    pre_cheapest_lookback_slots: '3',
  };

  it('no-op when there is no below-average cluster before the cheapest window', () => {
    // Single contiguous cheapest block — nothing to drop.
    const rates = [
      rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', 5),
      rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', 6),
      rate('2026-04-01T13:00:00Z', '2026-04-01T13:30:00Z', 7),
    ];
    const windows = findCheapestSlots(rates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, rates, droppingSettings);
    expect(dropped.size).toBe(0);
  });

  it('downgrades a single dropping slot inside the lookback window', () => {
    const windows = findCheapestSlots(droppingRates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, droppingRates, droppingSettings);
    // 10:30 is base-charge, sits 2 slots before the 12:00 cheapest → dropped.
    expect(dropped.has('2026-04-01T10:30:00Z')).toBe(true);
  });

  it('preserves negative-price slots even when inside the lookback zone', () => {
    // 10:30 is negative (-2p) and sits 2 slots before the cheapest trough at
    // 12:00/12:30 (-8/-9p). Without the negative-preserve check it would be
    // dropped as a "dropping" slot.
    const rates = [
      rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 20),
      rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', -2), // negative — preserve
      rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 25),
      rate('2026-04-01T11:30:00Z', '2026-04-01T12:00:00Z', 30),
      rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', -8),
      rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', -9),
    ];
    const windows = findCheapestSlots(rates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, rates, droppingSettings);
    expect(dropped.has('2026-04-01T10:30:00Z')).toBe(false);
  });

  it('preserves slots below the always_charge_below_price threshold', () => {
    const windows = findCheapestSlots(droppingRates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, droppingRates, {
      ...droppingSettings,
      always_charge_below_price: '16', // 14p slot at 10:30 is below this
    });
    expect(dropped.has('2026-04-01T10:30:00Z')).toBe(false);
  });

  it('disables the pass when pre_cheapest_lookback_slots is 0', () => {
    const windows = findCheapestSlots(droppingRates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, droppingRates, {
      ...droppingSettings,
      pre_cheapest_lookback_slots: '0',
    });
    expect(dropped.size).toBe(0);
  });

  it('does not touch slots beyond the lookback distance', () => {
    // lookback=1 → only the slot immediately before 12:00 (i.e. 11:30) is
    // in range, and that slot is not in baseWindows. 10:00/10:30 sit beyond
    // the window and must remain charge.
    const windows = findCheapestSlots(droppingRates, droppingSettings, { now: droppingNow });
    const dropped = findDroppingChargeKeys(windows, droppingRates, {
      ...droppingSettings,
      pre_cheapest_lookback_slots: '1',
    });
    expect(dropped.has('2026-04-01T10:00:00Z')).toBe(false);
    expect(dropped.has('2026-04-01T10:30:00Z')).toBe(false);
  });

  it('buildSchedulePlan rewrites dropped slots as hold in the planned slots', () => {
    const plan = buildSchedulePlan(droppingRates, droppingSettings, {
      now: droppingNow,
    });
    const dropped = plan.slots.find((s) => s.slot_start === '2026-04-01T10:30:00Z');
    const earliest = plan.slots.find((s) => s.slot_start === '2026-04-01T10:00:00Z');
    const trough = plan.slots.find((s) => s.slot_start === '2026-04-01T12:00:00Z');
    expect(dropped?.action).toBe('hold');
    // 10:00 is beyond the lookback (lookback=3, index 0, earliest=4 → start=1)
    expect(earliest?.action).toBe('charge');
    expect(trough?.action).toBe('charge');
  });
});
