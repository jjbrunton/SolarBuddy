import { describe, expect, it } from 'vitest';
import { findCheapestSlots } from '../engine';
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
  charging_strategy: 'night_fill',
  charge_hours: '4',
  price_threshold: '0',
  min_soc_target: '80',
  charge_window_start: '23:00',
  charge_window_end: '07:00',
  default_work_mode: 'Battery first',
  charge_rate: '100',
  auto_schedule: 'true',
  battery_capacity_kwh: '5.12',
  max_charge_power_kw: '3.6',
  estimated_consumption_w: '500',
  tariff_type: 'agile',
  tariff_offpeak_rate: '7.5',
  tariff_peak_rate: '35',
  tariff_standard_rate: '24.5',
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
  peak_protection: 'false',
  peak_period_start: '16:00',
  peak_period_end: '19:00',
  peak_soc_target: '90',
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
