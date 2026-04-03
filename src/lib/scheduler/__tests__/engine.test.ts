import { describe, expect, it } from 'vitest';
import { buildSchedulePlan, findCheapestSlots } from '../engine';
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
      estimated_consumption_w: '0',
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
      rate('2026-04-01T22:30:00Z', '2026-04-01T23:00:00Z', 42),
    ];

    const plan = buildSchedulePlan(rates, {
      ...baseSettings,
      charging_strategy: 'opportunistic_topup',
      smart_discharge: 'true',
      discharge_price_threshold: '40',
      min_soc_target: '50',
      charge_hours: '2',
      estimated_consumption_w: '0',
    }, {
      currentSoc: 40,
      now: new Date('2026-04-01T21:55:00Z'),
    });

    expect(plan.slots[0]).toMatchObject({
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    });
    expect(plan.slots[1]).toMatchObject({
      action: 'discharge',
      reason: 'Discharge slot selected by the arbitrage planner.',
    });
    expect(plan.slots.every((slot) => slot.expected_soc_after !== null)).toBe(true);
  });
});
