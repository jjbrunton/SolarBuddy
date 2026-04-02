import { describe, expect, it } from 'vitest';
import { buildSmartDischargePlan, calculateDischargeSlotsAvailable, findSmartDischargeSlots } from '../discharge';
import type { AgileRate } from '../../octopus/rates';
import type { AppSettings } from '../../config';

const baseSettings: AppSettings = {
  mqtt_host: '',
  mqtt_port: '1883',
  mqtt_username: '',
  mqtt_password: '',
  octopus_region: 'H',
  octopus_product_code: 'AGILE-24-10-01',
  octopus_api_key: '',
  octopus_account: '',
  octopus_mpan: '',
  octopus_meter_serial: '',
  charging_strategy: 'opportunistic_topup',
  charge_hours: '4',
  price_threshold: '0',
  min_soc_target: '80',
  charge_window_start: '23:00',
  charge_window_end: '07:00',
  default_work_mode: 'Battery first',
  charge_rate: '100',
  auto_schedule: 'true',
  battery_capacity_kwh: '5',
  max_charge_power_kw: '2',
  estimated_consumption_w: '500',
  tariff_type: 'agile',
  tariff_offpeak_rate: '7.5',
  tariff_peak_rate: '35',
  tariff_standard_rate: '24.5',
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
  smart_discharge: 'true',
  discharge_price_threshold: '0',
  discharge_soc_floor: '20',
  peak_protection: 'false',
  peak_period_start: '16:00',
  peak_period_end: '19:00',
  peak_soc_target: '90',
};

function rate(valid_from: string, valid_to: string, price: number): AgileRate {
  return { valid_from, valid_to, price_inc_vat: price, price_exc_vat: price };
}

describe('calculateDischargeSlotsAvailable', () => {
  it('uses the available energy above the reserve SOC floor', () => {
    expect(calculateDischargeSlotsAvailable(80, 20, baseSettings)).toBe(3);
  });

  it('returns zero when a full discharge slot would breach the reserve floor', () => {
    expect(calculateDischargeSlotsAvailable(30, 20, baseSettings)).toBe(0);
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
      estimated_consumption_w: '0',
    }, {
      currentSoc: 80,
      now: new Date('2026-04-01T10:15:00Z'),
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      slot_start: '2026-04-01T10:30:00Z',
      slot_end: '2026-04-01T11:00:00Z',
      type: 'discharge',
    });
    expect(windows[1]).toMatchObject({
      slot_start: '2026-04-01T11:30:00Z',
      slot_end: '2026-04-01T12:30:00Z',
      type: 'discharge',
    });
  });

  it('respects the discharge price threshold', () => {
    const windows = findSmartDischargeSlots(rates, {
      ...baseSettings,
      estimated_consumption_w: '0',
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
      estimated_consumption_w: '0',
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
    expect(plan.extraChargeWindows).toHaveLength(1);
    expect(plan.extraChargeWindows[0].slot_start).toBe('2026-04-01T00:30:00Z');
  });

  it('adds extra charge after an accepted discharge so the later target is still met', () => {
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
      estimated_consumption_w: '0',
    }, initialCharge, [], {
      currentSoc: 60,
      now: new Date('2026-04-01T17:30:00Z'),
    });

    expect(plan.dischargeWindows).toHaveLength(1);
    expect(plan.dischargeWindows[0].slot_start).toBe('2026-04-01T18:00:00Z');
    expect(plan.extraChargeWindows).toHaveLength(1);
    expect(plan.extraChargeWindows[0]).toMatchObject({
      slot_start: '2026-04-01T23:30:00Z',
      slot_end: '2026-04-02T00:00:00Z',
    });
  });
});
