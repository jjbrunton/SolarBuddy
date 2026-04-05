import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';
import type { InverterState } from '../../types';
import type { PlanAction } from '../../plan-actions';

const {
  startGridCharging,
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
  setWorkMode,
  setLoadFirstStopDischarge,
  appendEvent,
} = vi.hoisted(() => ({
  startGridCharging: vi.fn().mockResolvedValue(undefined),
  startGridDischarge: vi.fn().mockResolvedValue(undefined),
  startBatteryHold: vi.fn().mockResolvedValue(undefined),
  stopGridCharging: vi.fn().mockResolvedValue(undefined),
  stopGridDischarge: vi.fn().mockResolvedValue(undefined),
  setWorkMode: vi.fn().mockResolvedValue(undefined),
  setLoadFirstStopDischarge: vi.fn().mockResolvedValue(undefined),
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
    runtime_mode: 'real',
    virtual_scenario_id: null,
    virtual_scenario_name: null,
    virtual_playback_state: null,
    virtual_time: null,
    battery_soc: 40,
    pv_power: 200,
    grid_power: 800,
    load_power: 900,
    battery_power: 0,
    work_mode: 'Load first',
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
    ...DEFAULT_SETTINGS,
    mqtt_host: 'broker',
    octopus_region: 'H',
    charging_strategy: 'opportunistic_topup',
    watchdog_enabled: 'true',
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

vi.mock('../../scheduled-actions', () => ({
  evaluateScheduledActions: () => null,
}));

vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>();
  return {
    ...actual,
    getSettings: () => currentSettings,
  };
});

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
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
  setWorkMode,
  setLoadFirstStopDischarge,
}));

vi.mock('../../events', () => ({
  appendEvent,
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  getVirtualCurrentPlanSlot: () => null,
  getVirtualNow: () => new Date('2026-04-01T10:10:00Z'),
  isVirtualModeEnabled: () => false,
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
    setLoadFirstStopDischarge.mockClear();
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

  it('stops any forced charge and pins hold to current SOC when no active window applies', async () => {
    currentSettings = buildSettings({ default_work_mode: 'Load first' });
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
    });

    await reconcileInverterState('watchdog interval');

    expect(stopGridCharging).toHaveBeenCalledWith('Load first');
    expect(startBatteryHold).toHaveBeenCalledWith(40);
  });

  it('stops lingering grid charging before starting a discharge slot when charge read-back is unavailable', async () => {
    currentSettings = buildSettings({ default_work_mode: 'Load first' });
    currentState = buildState({
      work_mode: 'Load first',
      battery_first_grid_charge: null,
      pv_power: 150,
      load_power: 1170,
      grid_power: 4018,
      battery_power: 2990,
    });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'discharge',
      reason: 'Discharge slot selected by the arbitrage planner.',
    };

    await reconcileInverterState('watchdog startup');

    expect(stopGridCharging).toHaveBeenCalledWith('Load first');
    expect(startGridDischarge).toHaveBeenCalled();
  });

  it('holds a scheduled opportunistic charge window when solar surplus is already covering demand', async () => {
    currentSettings = buildSettings({ default_work_mode: 'Load first' });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    currentState = buildState({
      battery_soc: 72,
      work_mode: 'Battery first',
      pv_power: 1800,
      load_power: 400,
      grid_power: -300,
      battery_power: 150,
    });

    await reconcileInverterState('watchdog startup');

    expect(stopGridCharging).toHaveBeenCalledWith('Load first');
    expect(startGridCharging).not.toHaveBeenCalled();
    expect(startBatteryHold).toHaveBeenCalledWith(72);
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

  it('does not consider hold satisfied when load_first_stop_discharge is far below SOC', async () => {
    currentState = buildState({
      battery_soc: 56,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 20,
    });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery.',
    };

    await reconcileInverterState('watchdog startup');

    expect(startBatteryHold).toHaveBeenCalledWith(56);
  });

  it('considers hold satisfied when load_first_stop_discharge matches SOC', async () => {
    currentState = buildState({
      battery_soc: 56,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 56,
    });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery.',
    };

    await reconcileInverterState('watchdog startup');

    expect(startBatteryHold).not.toHaveBeenCalled();
  });

  it('sets load_first_stop_discharge to floor when transitioning from hold to charge', async () => {
    currentSettings = buildSettings({ discharge_soc_floor: '15' });
    currentState = buildState({ battery_soc: 40 });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery.',
    };
    await reconcileInverterState('enter hold');
    expect(startBatteryHold).toHaveBeenCalledWith(40);

    startBatteryHold.mockClear();
    setLoadFirstStopDischarge.mockClear();

    // Simulate inverter now in hold state
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 40,
    });

    // Transition to charge
    planSlotRow = {
      slot_start: '2026-04-01T10:30:00Z',
      slot_end: '2026-04-01T11:00:00Z',
      action: 'charge',
      reason: 'Charge slot.',
    };
    await reconcileInverterState('transition to charge');

    expect(setLoadFirstStopDischarge).toHaveBeenCalledWith(15);
    expect(startGridCharging).toHaveBeenCalledWith(100);
  });

  it('treats a slot gap as a hold at current SOC (no idle fallback)', async () => {
    currentSettings = buildSettings({ discharge_soc_floor: '25' });
    currentState = buildState({ battery_soc: 40 });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery.',
    };
    await reconcileInverterState('enter hold');
    expect(startBatteryHold).toHaveBeenCalledWith(40);

    startBatteryHold.mockClear();

    // Hold state is already satisfied (stop_discharge pinned to SOC).
    // When the plan slot ends and there's no next slot, the intent should still be
    // hold, and because the state already matches, no new commands should fire.
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 40,
    });
    planSlotRow = null;
    await reconcileInverterState('plan gap');

    expect(startBatteryHold).not.toHaveBeenCalled();
    expect(startGridCharging).not.toHaveBeenCalled();
    expect(startGridDischarge).not.toHaveBeenCalled();
  });

  it('sets load_first_stop_discharge to floor when transitioning from hold to discharge', async () => {
    currentSettings = buildSettings({ discharge_soc_floor: '15' });
    currentState = buildState({ battery_soc: 40 });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'hold',
      reason: 'Hold battery.',
    };
    await reconcileInverterState('enter hold');

    setLoadFirstStopDischarge.mockClear();

    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 40,
    });
    planSlotRow = {
      slot_start: '2026-04-01T10:30:00Z',
      slot_end: '2026-04-01T11:00:00Z',
      action: 'discharge',
      reason: 'Discharge slot.',
    };
    await reconcileInverterState('transition to discharge');

    expect(setLoadFirstStopDischarge).toHaveBeenCalledWith(15);
    expect(startGridDischarge).toHaveBeenCalled();
  });

  it('re-pins stop-discharge to current SOC on startup when no plan is active and state is stale', async () => {
    currentSettings = buildSettings({ discharge_soc_floor: '25' });
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Load first',
      load_first_stop_discharge: 84,
    });

    // No plan slot — new model treats this as hold at current SOC, not fallback to floor.
    planSlotRow = null;
    await reconcileInverterState('watchdog startup');

    expect(startBatteryHold).toHaveBeenCalledWith(40);
  });
});
