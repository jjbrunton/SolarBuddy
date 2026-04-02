import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../config';
import type { InverterState } from '../../types';
import type { PlanAction } from '../../plan-actions';

const {
  startGridCharging,
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
  setWorkMode,
  appendEvent,
} = vi.hoisted(() => ({
  startGridCharging: vi.fn().mockResolvedValue(undefined),
  startGridDischarge: vi.fn().mockResolvedValue(undefined),
  startBatteryHold: vi.fn().mockResolvedValue(undefined),
  stopGridCharging: vi.fn().mockResolvedValue(undefined),
  stopGridDischarge: vi.fn().mockResolvedValue(undefined),
  setWorkMode: vi.fn().mockResolvedValue(undefined),
  appendEvent: vi.fn(),
}));

type OverrideRow = {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
};

type PlanSlotRow = {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string | null;
};

const listeners = new Set<(state: InverterState) => void>();

let overrideRow: OverrideRow | null = null;
let planSlotRow: PlanSlotRow | null = null;
let currentState: InverterState;
let currentSettings: AppSettings;

function buildState(partial: Partial<InverterState> = {}): InverterState {
  return {
    battery_soc: 40,
    pv_power: 200,
    grid_power: 800,
    load_power: 900,
    battery_power: 0,
    work_mode: 'Battery first',
    mqtt_connected: true,
    last_updated: new Date().toISOString(),
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
    battery_first_grid_charge: 'Disabled',
    battery_first_stop_charge: null,
    load_first_stop_discharge: null,
    grid_first_discharge_rate: null,
    max_charge_current: null,
    battery_absorption_charge_voltage: null,
    battery_float_charge_voltage: null,
    output_source_priority: 'USB',
    bus_voltage: null,
    ...partial,
  };
}

function buildSettings(partial: Partial<AppSettings> = {}): AppSettings {
  return {
    mqtt_host: 'broker',
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
    ...partial,
  };
}

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes('FROM manual_overrides')) {
          return overrideRow;
        }
        if (sql.includes('FROM plan_slots')) {
          return planSlotRow;
        }
        return null;
      },
    }),
  }),
}));

vi.mock('../../config', () => ({
  getSettings: () => currentSettings,
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

vi.mock('../../mqtt/commands', () => ({
  startGridCharging,
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
  setWorkMode,
}));

vi.mock('../../events', () => ({
  appendEvent,
}));

import {
  reconcileInverterState,
  resolveRuntimeIntent,
  startInverterWatchdog,
  stopInverterWatchdog,
} from '../watchdog';

describe('resolveRuntimeIntent', () => {
  beforeEach(() => {
    currentSettings = buildSettings();
    currentState = buildState();
    overrideRow = null;
    planSlotRow = null;
  });

  it('gives the current manual override precedence over scheduled windows', () => {
    overrideRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
    };
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    expect(resolveRuntimeIntent(new Date('2026-04-01T10:10:00Z'), currentState)).toMatchObject({
      action: 'hold',
      reason: 'manual_override',
      slotStart: '2026-04-01T10:00:00Z',
    });
  });
});

describe('reconcileInverterState', () => {
  beforeEach(() => {
    currentSettings = buildSettings();
    currentState = buildState();
    overrideRow = null;
    planSlotRow = null;
    listeners.clear();
    startGridCharging.mockClear();
    startGridDischarge.mockClear();
    startBatteryHold.mockClear();
    stopGridCharging.mockClear();
    stopGridDischarge.mockClear();
    setWorkMode.mockClear();
    appendEvent.mockClear();
  });

  afterEach(() => {
    stopInverterWatchdog();
  });

  it('starts grid charging immediately for an active manual charge override', async () => {
    overrideRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
    };

    await reconcileInverterState('manual override updated');

    expect(startGridCharging).toHaveBeenCalledWith(100);
    expect(stopGridCharging).not.toHaveBeenCalled();
  });

  it('starts grid charging for a persisted active schedule window after startup reconciliation', async () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    await reconcileInverterState('watchdog startup');

    expect(startGridCharging).toHaveBeenCalledWith(100);
  });

  it('puts the inverter into hold mode for an active hold slot', async () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery for a better discharge opportunity later in the tariff horizon.',
    };

    await reconcileInverterState('watchdog startup');

    expect(startBatteryHold).toHaveBeenCalled();
    expect(startGridCharging).not.toHaveBeenCalled();
    expect(startGridDischarge).not.toHaveBeenCalled();
  });

  it('restores the default mode when no active window should be forcing charge', async () => {
    currentState = buildState({
      work_mode: 'Grid first',
      battery_first_grid_charge: 'Enabled',
    });

    await reconcileInverterState('watchdog interval');

    expect(stopGridCharging).toHaveBeenCalledWith('Battery first');
  });

  it('holds a scheduled opportunistic charge window when solar surplus is already covering demand', async () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    currentState = buildState({
      work_mode: 'Grid first',
      battery_first_grid_charge: 'Enabled',
      pv_power: 1800,
      load_power: 400,
      grid_power: -300,
      battery_power: 150,
    });

    await reconcileInverterState('watchdog startup');

    expect(stopGridCharging).toHaveBeenCalledWith('Battery first');
    expect(startGridCharging).not.toHaveBeenCalled();
  });

  it('does not start the background watchdog loop when disabled in settings', async () => {
    currentSettings = buildSettings({ watchdog_enabled: 'false' });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    startInverterWatchdog();
    await Promise.resolve();

    expect(listeners.size).toBe(0);
    expect(startGridCharging).not.toHaveBeenCalled();
  });
});
