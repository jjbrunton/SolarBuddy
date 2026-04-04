import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InverterState } from '../../types';
import type { ChargeWindow } from '../engine';

const {
  startGridCharging,
  stopGridCharging,
  runMock,
  prepareMock,
} = vi.hoisted(() => {
  const run = vi.fn();
  return {
    startGridCharging: vi.fn().mockResolvedValue(undefined),
    stopGridCharging: vi.fn().mockResolvedValue(undefined),
    runMock: run,
    prepareMock: vi.fn(() => ({ run })),
  };
});

let currentState: InverterState = {
  runtime_mode: 'real',
  virtual_scenario_id: null,
  virtual_scenario_name: null,
  virtual_playback_state: null,
  virtual_time: null,
  battery_soc: 40,
  pv_power: 1400,
  grid_power: -200,
  load_power: 500,
  battery_power: 100,
  work_mode: 'Battery first',
  mqtt_connected: true,
  last_updated: null,
  battery_voltage: null,
  battery_temperature: null,
  inverter_temperature: null,
  grid_voltage: null,
  device_mode: null,
  pv_voltage_1: null,
  pv_voltage_2: null,
  pv_current_1: null,
  pv_current_2: null,
  pv_power_1: null,
  pv_power_2: null,
  grid_frequency: null,
  battery_first_charge_rate: null,
  battery_first_grid_charge: null,
  battery_first_stop_charge: null,
  load_first_stop_discharge: null,
  grid_first_discharge_rate: null,
  max_charge_current: null,
  battery_absorption_charge_voltage: null,
  battery_float_charge_voltage: null,
  output_source_priority: null,
  bus_voltage: null,
};

const listeners = new Set<(state: InverterState) => void>();

vi.mock('../../config', () => ({
  getSettings: () => ({
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
    watchdog_enabled: 'true',
    battery_capacity_kwh: '5.12',
    max_charge_power_kw: '3.6',
    estimated_consumption_w: '500',
    tariff_type: 'agile',
    tariff_offpeak_rate: '7.5',
    tariff_peak_rate: '35',
    tariff_standard_rate: '24.5',
    negative_price_charging: 'true',
    negative_price_pre_discharge: 'false',
    smart_discharge: 'false',
    discharge_price_threshold: '0',
    discharge_soc_floor: '20',
    peak_protection: 'false',
    peak_period_start: '16:00',
    peak_period_end: '19:00',
    peak_soc_target: '90',
    octopus_export_mpan: '',
    octopus_export_meter_serial: '',
    octopus_export_product_code: '',
    export_rate: '0',
    pv_forecast_enabled: 'false',
    pv_forecast_confidence: 'estimate',
    pv_latitude: '',
    pv_longitude: '',
    pv_declination: '35',
    pv_azimuth: '0',
    pv_kwp: '',
    time_sync_enabled: 'false',
    tariff_monitor_enabled: 'true',
    virtual_mode_enabled: 'false',
    virtual_scenario_id: 'overnight-recovery',
    virtual_speed: '6x',
  }),
}));

vi.mock('../../state', () => ({
  getState: () => currentState,
  onStateChange: (listener: (state: InverterState) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
}));

vi.mock('../../inverter/commands', () => ({
  startGridCharging,
  stopGridCharging,
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

import { clearScheduledTimers, scheduleExecution, shouldHoldForSolarSurplus } from '../executor';

function emitState(partial: Partial<InverterState>) {
  currentState = { ...currentState, ...partial };
  for (const listener of listeners) {
    listener(currentState);
  }
}

describe('shouldHoldForSolarSurplus', () => {
  it('returns true when the site is exporting or charging without importing', () => {
    expect(shouldHoldForSolarSurplus({
      pv_power: 1400,
      load_power: 500,
      grid_power: -200,
      battery_power: 100,
    })).toBe(true);
  });

  it('returns false when the battery needs grid support', () => {
    expect(shouldHoldForSolarSurplus({
      pv_power: 200,
      load_power: 900,
      grid_power: 700,
      battery_power: 0,
    })).toBe(false);
  });
});

describe('scheduleExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T11:05:00Z'));
    currentState = {
      ...currentState,
      battery_soc: 40,
      pv_power: 1400,
      grid_power: -200,
      load_power: 500,
      battery_power: 100,
    };
    listeners.clear();
    startGridCharging.mockClear();
    stopGridCharging.mockClear();
    prepareMock.mockClear();
    runMock.mockClear();
  });

  afterEach(() => {
    clearScheduledTimers();
    vi.useRealTimers();
  });

  it('waits for solar surplus to disappear before forcing grid charging in opportunistic mode', async () => {
    const windows: ChargeWindow[] = [
      {
        slot_start: '2026-03-30T11:00:00Z',
        slot_end: '2026-03-30T11:30:00Z',
        avg_price: 1,
        slots: [],
      },
    ];

    scheduleExecution(windows);
    await vi.advanceTimersByTimeAsync(0);

    expect(startGridCharging).not.toHaveBeenCalled();

    emitState({
      pv_power: 200,
      load_power: 900,
      grid_power: 700,
      battery_power: 0,
    });
    await Promise.resolve();

    expect(startGridCharging).toHaveBeenCalledWith(100);

    emitState({
      battery_soc: 82,
    });
    await Promise.resolve();

    expect(stopGridCharging).toHaveBeenCalledWith('Battery first');
  });
});
