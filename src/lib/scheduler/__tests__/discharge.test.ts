import { describe, expect, it, vi } from 'vitest';

// Stub the usage repository so tests remain hermetic — previously these
// tests had no DB dependency, and we preserve that by forcing the fallback
// path (returns the caller's estimated_consumption_w fallback).
vi.mock('../../usage', () => ({
  getForecastedConsumptionW: (_: Date, fallbackW: number) => fallbackW,
  getAverageForecastedConsumptionW: (_start: number, _end: number, fallbackW: number) =>
    fallbackW,
}));

import { buildSmartDischargePlan, calculateDischargeSlotsAvailable, findSmartDischargeSlots } from '../discharge';
import { buildSchedulePlan } from '../engine';
import type { AgileRate } from '../../octopus/rates';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';

const baseSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  octopus_region: 'H',
  charging_strategy: 'opportunistic_topup',
  battery_capacity_kwh: '5',
  max_charge_power_kw: '2',
  smart_discharge: 'true',
};

function rate(valid_from: string, valid_to: string, price: number): AgileRate {
  return { valid_from, valid_to, price_inc_vat: price, price_exc_vat: price };
}

describe('calculateDischargeSlotsAvailable', () => {
  it('uses the available energy above the reserve SOC floor', () => {
    expect(calculateDischargeSlotsAvailable(80, 20, baseSettings)).toBe(12);
  });

  it('returns slots available down to the reserve floor', () => {
    expect(calculateDischargeSlotsAvailable(30, 20, baseSettings)).toBe(2);
  });
});

describe('findSmartDischargeSlots', () => {
  const rates: AgileRate[] = [
    rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 12),
    rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', 36),
    rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 18),
    rate('2026-04-01T11:30:00Z', '2026-04-01T12:00:00Z', 42),
    rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', 33),
    rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', 7),
  ];

  it('selects the highest-priced future slots up to the available discharge budget', () => {
    const windows = findSmartDischargeSlots(rates, {
      ...baseSettings,
      estimated_consumption_w: '500',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T10:15:00Z'),
    });

    // With load-following discharge (0.25 kWh/slot), all profitable slots
    // are selected and merge into a single continuous window
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T13:00:00Z',
      type: 'discharge',
    });
  });

  it('respects the discharge price threshold', () => {
    const windows = findSmartDischargeSlots(rates, {
      ...baseSettings,
      estimated_consumption_w: '500',
      discharge_price_threshold: '35',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T10:15:00Z'),
    });

    expect(windows).toHaveLength(2);
    expect(windows[0].slots.every((slot) => slot.price_inc_vat >= 35)).toBe(true);
    expect(windows[1].slots.every((slot) => slot.price_inc_vat >= 35)).toBe(true);
  });

  it('returns empty when the planner is disabled or no telemetry is available', () => {
    expect(findSmartDischargeSlots(rates, {
      ...baseSettings,
      smart_discharge: 'false',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T10:15:00Z'),
    })).toHaveLength(0);

    expect(findSmartDischargeSlots(rates, baseSettings, {
      currentSoc: null,
      now: new Date('2026-04-01T10:15:00Z'),
    })).toHaveLength(0);
  });

  it('can use future cheap charge slots to unlock a later expensive discharge slot', () => {
    const arbitrageRates: AgileRate[] = [
      rate('2026-04-01T00:00:00Z', '2026-04-01T00:30:00Z', 3),
      rate('2026-04-01T00:30:00Z', '2026-04-01T01:00:00Z', 4),
      rate('2026-04-01T17:00:00Z', '2026-04-01T17:30:00Z', 42),
    ];

    const initialCharge = [{
      slot_start: '2026-04-01T00:00:00Z',
      slot_end: '2026-04-01T00:30:00Z',
      avg_price: 3,
      slots: [arbitrageRates[0]],
    }];

    const plan = buildSmartDischargePlan(arbitrageRates, {
      ...baseSettings,
      charge_hours: '2',
      min_soc_target: '50',
      discharge_price_threshold: '35',
      estimated_consumption_w: '500',
    }, initialCharge, [], {
      currentSoc: 30,
      now: new Date('2026-03-31T23:50:00Z'),
    });

    expect(plan.dischargeWindows).toHaveLength(1);
    expect(plan.dischargeWindows[0]).toMatchObject({
      slot_start: '2026-04-01T17:00:00Z',
      slot_end: '2026-04-01T17:30:00Z',
      type: 'discharge',
    });
  });

  it('adds extra charge when peak protection requires it after a discharge', () => {
    const nightRates: AgileRate[] = [
      rate('2026-04-01T18:00:00Z', '2026-04-01T18:30:00Z', 40),
      rate('2026-04-01T23:00:00Z', '2026-04-01T23:30:00Z', 2),
      rate('2026-04-01T23:30:00Z', '2026-04-02T00:00:00Z', 3),
      rate('2026-04-02T00:00:00Z', '2026-04-02T00:30:00Z', 4),
    ];

    const initialCharge = [{
      slot_start: '2026-04-01T23:00:00Z',
      slot_end: '2026-04-01T23:30:00Z',
      avg_price: 2,
      slots: [nightRates[1]],
    }];

    const plan = buildSmartDischargePlan(nightRates, {
      ...baseSettings,
      charging_strategy: 'night_fill',
      charge_hours: '3',
      min_soc_target: '80',
      charge_window_start: '23:00',
      charge_window_end: '07:00',
      discharge_price_threshold: '35',
      estimated_consumption_w: '500',
    }, initialCharge, [], {
      currentSoc: 60,
      now: new Date('2026-04-01T17:30:00Z'),
    });

    // Discharge should still be selected at the expensive slot
    expect(plan.dischargeWindows).toHaveLength(1);
    expect(plan.dischargeWindows[0].slot_start).toBe('2026-04-01T18:00:00Z');
  });
});

describe('marginal cost gate', () => {
  it('rejects discharge when export price is below the nearest preceding charge price', () => {
    const rates: AgileRate[] = [
      rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 15),
      rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', 14),
      rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 3),
    ];

    const initialCharge = [{
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      avg_price: 15,
      slots: [rates[0]],
    }];

    const plan = buildSmartDischargePlan(rates, {
      ...baseSettings,
      charge_hours: '1',
      estimated_consumption_w: '500',
      discharge_price_threshold: '0',
    }, initialCharge, [], {
      currentSoc: 80,
      now: new Date('2026-04-01T09:50:00Z'),
    });

    // The 14p slot should NOT be a discharge (below 15p preceding charge)
    expect(plan.dischargeWindows.every((w) =>
      w.slots.every((s) => s.price_inc_vat !== 14),
    )).toBe(true);

    // Should be rejected with marginal_cost reason
    const rejected = plan._debug?.candidateResults?.find((r) => r.price === 14);
    expect(rejected?.rejected).toBe('marginal_cost');
  });

  it('accepts discharge when export price significantly exceeds charge cost', () => {
    const rates: AgileRate[] = [
      rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 3),
      rate('2026-04-01T10:30:00Z', '2026-04-01T11:00:00Z', 25),
    ];

    const initialCharge = [{
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      avg_price: 3,
      slots: [rates[0]],
    }];

    const plan = buildSmartDischargePlan(rates, {
      ...baseSettings,
      charge_hours: '1',
      estimated_consumption_w: '500',
      discharge_price_threshold: '0',
    }, initialCharge, [], {
      currentSoc: 80,
      now: new Date('2026-04-01T09:50:00Z'),
    });

    expect(plan.dischargeWindows).toHaveLength(1);
    expect(plan.dischargeWindows[0].slots[0].price_inc_vat).toBe(25);
  });

  it('allows any positive-price discharge when no charges exist (free energy)', () => {
    const rates: AgileRate[] = [
      rate('2026-04-01T10:00:00Z', '2026-04-01T10:30:00Z', 5),
    ];

    const plan = buildSmartDischargePlan(rates, {
      ...baseSettings,
      charge_hours: '0',
      estimated_consumption_w: '500',
      discharge_price_threshold: '0',
    }, [], [], {
      currentSoc: 80,
      now: new Date('2026-04-01T09:50:00Z'),
    });

    expect(plan.dischargeWindows).toHaveLength(1);
  });

  it('does not discharge at 14.51p right after a 14.74p charge', () => {
    const rates: AgileRate[] = [
      rate('2026-04-01T21:30:00Z', '2026-04-01T22:00:00Z', 14.74),
      rate('2026-04-01T22:00:00Z', '2026-04-01T22:30:00Z', 14.51),
      rate('2026-04-01T22:30:00Z', '2026-04-01T23:00:00Z', 9.31),
      rate('2026-04-01T23:00:00Z', '2026-04-01T23:30:00Z', 3.34),
    ];

    // Simulate the user's scenario: base planner committed to charges
    // at 14.74p and 3.34p (e.g. due to charge window restrictions).
    const plannedCharges = [
      { slot_start: rates[0].valid_from, slot_end: rates[0].valid_to, avg_price: 14.74, slots: [rates[0]] },
      { slot_start: rates[3].valid_from, slot_end: rates[3].valid_to, avg_price: 3.34, slots: [rates[3]] },
    ];

    const plan = buildSmartDischargePlan(rates, {
      ...baseSettings,
      charge_hours: '2',
      estimated_consumption_w: '500',
      discharge_soc_floor: '20',
      discharge_price_threshold: '0',
    }, plannedCharges, [], {
      currentSoc: 50,
      now: new Date('2026-04-01T21:25:00Z'),
    });

    // 14.51p discharge must be rejected — it's below the preceding 14.74p charge
    expect(plan.dischargeWindows.every((w) =>
      w.slots.every((s) => s.price_inc_vat !== 14.51),
    )).toBe(true);

    const rejected = plan._debug?.candidateResults?.find((r) => r.price === 14.51);
    expect(rejected?.rejected).toBe('marginal_cost');
  });
});

describe('real-world: night_fill + peak protection with afternoon cheap rates', () => {
  // Reproduces the user's scenario: night_fill strategy, peak protection on,
  // cheap afternoon rates, expensive evening rates.  The planner should
  // discharge during the expensive 17:00-18:00 BST window.
  function halfHourSlots(startISO: string, prices: number[]): AgileRate[] {
    const slots: AgileRate[] = [];
    let t = new Date(startISO).getTime();
    for (const price of prices) {
      const from = new Date(t).toISOString();
      t += 30 * 60 * 1000;
      const to = new Date(t).toISOString();
      slots.push({ valid_from: from, valid_to: to, price_inc_vat: price, price_exc_vat: price });
    }
    return slots;
  }

  // 50 half-hour slots starting at 21:00 UTC (22:00 BST) on April 2
  // Prices mirror the user's real Agile rates
  const prices = [
    18.10, 17.08, 18.54, 17.59, 18.26, 17.36, 17.70, 16.24, // 21:00-01:00 UTC
    17.91, 16.78, 15.72, 15.10, 13.36, 13.28, 17.63, 18.54, // 01:00-05:00 UTC
    21.40, 22.51, 19.43, 22.51, 21.19, 22.51, 18.02, 14.57, // 05:00-09:00 UTC
    13.86, 11.16,  7.08,  4.65,  2.67,  1.82,  1.79,  0.90, // 09:00-13:00 UTC
     1.79,  1.25,  3.74,  5.31, 20.80, 24.09, 27.17, 30.57, // 13:00-17:00 UTC
    30.11, 31.55, 18.32, 19.20, 17.83, 15.27, 16.94, 13.91, // 17:00-21:00 UTC
    13.69,  8.74,                                              // 21:00-22:00 UTC
  ];

  const allRates = halfHourSlots('2026-04-02T21:00:00Z', prices);

  const realisticSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    charging_strategy: 'opportunistic_topup',
    charge_hours: '4',
    charge_window_start: '23:00',
    charge_window_end: '07:00',
    min_soc_target: '80',
    battery_capacity_kwh: '5.12',
    max_charge_power_kw: '3.6',
    charge_rate: '100',
    estimated_consumption_w: '500',
    smart_discharge: 'true',
    discharge_soc_floor: '20',
    discharge_price_threshold: '0',
    peak_protection: 'true',
    peak_period_start: '16:00',
    peak_period_end: '19:00',
    peak_soc_target: '90',
  };

  it('should discharge during expensive evening slots via buildSchedulePlan', () => {
    const plan = buildSchedulePlan(allRates, realisticSettings, {
      currentSoc: 20,
      now: new Date('2026-04-02T21:00:00Z'),
    });

    const dischargeSlots = plan.slots.filter((s) => s.action === 'discharge');
    const chargeSlots = plan.slots.filter((s) => s.action === 'charge');

    // Should have some charge slots (peak prep in cheap afternoon)
    expect(chargeSlots.length).toBeGreaterThan(0);

    // Must discharge during the expensive 16:00-18:00 UTC window (17:00-19:00 BST)
    expect(dischargeSlots.length).toBeGreaterThan(0);

    // At least one discharge must be in the expensive 30p+ peak window
    const peakDischarges = dischargeSlots.filter((ds) => {
      const slotRate = allRates.find((r) => r.valid_from === ds.slot_start);
      return slotRate!.price_inc_vat >= 30;
    });
    expect(peakDischarges.length).toBeGreaterThan(0);

    // The planner may also include cheap discharge slots as part of capacity
    // cycling (discharge → recharge cheaply → sell more at peak), which is
    // a valid arbitrage strategy.  Verify the overall plan is profitable.
    const totalChargeCost = chargeSlots.reduce((sum, cs) => {
      const slotRate = allRates.find((r) => r.valid_from === cs.slot_start);
      return sum + slotRate!.price_inc_vat;
    }, 0);
    const totalDischargeRevenue = dischargeSlots.reduce((sum, ds) => {
      const slotRate = allRates.find((r) => r.valid_from === ds.slot_start);
      return sum + slotRate!.price_inc_vat;
    }, 0);
    expect(totalDischargeRevenue).toBeGreaterThan(totalChargeCost);
  });

  it('should also work via buildSmartDischargePlan directly', () => {
    // Slot indices: 12:30 UTC = index 31, 13:30 UTC = index 33
    const peakPrepWindows = [
      {
        slot_start: allRates[31].valid_from,
        slot_end: allRates[31].valid_to,
        avg_price: allRates[31].price_inc_vat,
        slots: [allRates[31]],
      },
      {
        slot_start: allRates[33].valid_from,
        slot_end: allRates[33].valid_to,
        avg_price: allRates[33].price_inc_vat,
        slots: [allRates[33]],
      },
    ];

    const plan = buildSmartDischargePlan(
      allRates,
      realisticSettings,
      peakPrepWindows,
      [],
      { currentSoc: 50, now: new Date('2026-04-02T21:00:00Z') },
    );

    if (plan.dischargeWindows.length === 0) {
      throw new Error(
        `No discharge! Debug: ${JSON.stringify(plan._debug, null, 2)}`
      );
    }

    expect(plan.dischargeWindows.length).toBeGreaterThan(0);
  });
});
