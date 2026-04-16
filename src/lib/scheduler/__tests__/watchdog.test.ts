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
  recordSlotExecution,
  updateSlotExecutionActuals,
  getLatestExecutionForSlot,
  getCurrentAutoOverride,
} = vi.hoisted(() => ({
  startGridCharging: vi.fn().mockResolvedValue(undefined),
  startGridDischarge: vi.fn().mockResolvedValue(undefined),
  startBatteryHold: vi.fn().mockResolvedValue(undefined),
  stopGridCharging: vi.fn().mockResolvedValue(undefined),
  stopGridDischarge: vi.fn().mockResolvedValue(undefined),
  setWorkMode: vi.fn().mockResolvedValue(undefined),
  setLoadFirstStopDischarge: vi.fn().mockResolvedValue(undefined),
  appendEvent: vi.fn(),
  recordSlotExecution: vi.fn().mockReturnValue(1),
  updateSlotExecutionActuals: vi.fn(),
  getLatestExecutionForSlot: vi.fn().mockReturnValue(null),
  getCurrentAutoOverride: vi.fn().mockReturnValue(null),
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
let planSlotRows: PlanSlotRow[] | null = null;
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

vi.mock('../../db/schedule-repository', () => ({
  recordSlotExecution,
  updateSlotExecutionActuals,
  getLatestExecutionForSlot,
}));

vi.mock('../../db/auto-override-repository', () => ({
  getCurrentAutoOverride,
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (a?: string, b?: string) => {
        if (sql.includes('FROM manual_overrides')) {
          if (!overrideRow) return null;
          const ts = a ?? b;
          if (!ts) return overrideRow;
          if (ts >= overrideRow.slot_start && ts < overrideRow.slot_end) {
            return overrideRow;
          }
          return null;
        }
        if (sql.includes('FROM plan_slots') && sql.includes('slot_start <=')) {
          return planSlotRow;
        }
        return null;
      },
      all: (_a?: string, _b?: number) => {
        if (sql.includes('FROM plan_slots') && sql.includes('slot_end >')) {
          if (planSlotRows) return planSlotRows;
          return planSlotRow ? [planSlotRow] : [];
        }
        return [];
      },
    }),
  }),
}));

vi.mock('../../scheduled-actions', () => ({
  evaluateScheduledActions: () => null,
}));

// Stub out the usage module to keep the watchdog tests hermetic — the real
// module transitively hits the DB and pulls in unrelated WIP code.
vi.mock('../../usage', () => ({
  getForecastedConsumptionW: () => 0,
  getBaseloadW: () => 0,
  getAverageForecastedConsumptionW: () => 0,
  getUsageHighPeriods: () => [],
  getUsageProfile: () => null,
  invalidateUsageProfileCache: () => {},
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
    planSlotRows = null;
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
    planSlotRows = null;
    listeners.clear();
    startGridCharging.mockClear();
    startGridDischarge.mockClear();
    startBatteryHold.mockClear();
    stopGridCharging.mockClear();
    stopGridDischarge.mockClear();
    setWorkMode.mockClear();
    setLoadFirstStopDischarge.mockClear();
    appendEvent.mockClear();
    recordSlotExecution.mockClear();
    recordSlotExecution.mockReturnValue(1);
    updateSlotExecutionActuals.mockClear();
    getLatestExecutionForSlot.mockClear();
    getLatestExecutionForSlot.mockReturnValue(null);
    getCurrentAutoOverride.mockClear();
    getCurrentAutoOverride.mockReturnValue(null);
    // Reset the global watchdog state so the cooldown/lastCommand state doesn't
    // bleed between tests.
    stopInverterWatchdog();
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

  it('asserts hold once on cold start then suppresses subsequent ticks while the inverter still reports the pinned value', async () => {
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

    // First tick (cold start): we don't trust whatever state we find, assert once.
    await reconcileInverterState('watchdog startup');
    expect(startBatteryHold).toHaveBeenCalledWith(56);

    startBatteryHold.mockClear();

    // Second tick: SOC has drifted upward from solar top-up (the scenario that
    // used to trigger the ±3% tolerance re-pin loop). stop_discharge still
    // reports the value we pinned, so hold is satisfied — no new command.
    currentState = buildState({
      battery_soc: 72,
      work_mode: 'Load first',
      output_source_priority: 'USB',
      battery_first_grid_charge: 'Disabled',
      load_first_stop_discharge: 56,
    });
    await reconcileInverterState('tick — soc drifted');
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

  it('suppresses the write when charge state is already satisfied', async () => {
    currentSettings = buildSettings({ charge_rate: '100' });
    // Plan slot wants charge; state already reports the desired charge posture.
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 100,
      battery_first_grid_charge: 'Enabled',
    });

    await reconcileInverterState('state-satisfied charge');

    expect(startGridCharging).not.toHaveBeenCalled();
    expect(stopGridCharging).not.toHaveBeenCalled();
    expect(startBatteryHold).not.toHaveBeenCalled();
    expect(startGridDischarge).not.toHaveBeenCalled();
  });

  it('treats a charge rate within ±2pp of the desired rate as satisfied', async () => {
    currentSettings = buildSettings({ charge_rate: '80' });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    // Inverter read-back rounded down by 1pp. Under exact-match equality this
    // would re-fire every cooldown expiry; the tolerance absorbs it.
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 79,
      battery_first_grid_charge: 'Enabled',
    });

    await reconcileInverterState('fuzzy-match charge rate');

    expect(startGridCharging).not.toHaveBeenCalled();
  });

  it('re-issues the charge command when the read-back rate drifts beyond the tolerance', async () => {
    currentSettings = buildSettings({ charge_rate: '80' });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 70,
      battery_first_grid_charge: 'Enabled',
    });

    await reconcileInverterState('out-of-tolerance charge rate');

    expect(startGridCharging).toHaveBeenCalledWith(80);
  });

  it('re-issues the charge command when state drifts away from the desired posture', async () => {
    currentSettings = buildSettings({ charge_rate: '100' });
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    // First tick: state already satisfies the charge intent → no write.
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 100,
      battery_first_grid_charge: 'Enabled',
    });
    await reconcileInverterState('tick 1 — satisfied');
    expect(startGridCharging).not.toHaveBeenCalled();

    // Second tick: state has drifted back to Load first. Even though the plan
    // still says charge and no cooldown was recorded (since we suppressed the
    // earlier write without touching the timers), the command must fire.
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Load first',
      battery_first_charge_rate: null,
      battery_first_grid_charge: 'Disabled',
    });
    await reconcileInverterState('tick 2 — drift');
    expect(startGridCharging).toHaveBeenCalledWith(100);
  });

  it('keeps the command signature stable across two ticks inside the same conflated run', async () => {
    // Three contiguous charge plan slots: the range walker conflates them.
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    planSlotRows = [
      planSlotRow,
      {
        slot_start: '2026-04-01T10:30:00Z',
        slot_end: '2026-04-01T11:00:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      },
      {
        slot_start: '2026-04-01T11:00:00Z',
        slot_end: '2026-04-01T11:30:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      },
    ];

    // Tick 1: state is not yet satisfied, command fires.
    currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });
    await reconcileInverterState('tick 1');
    expect(startGridCharging).toHaveBeenCalledTimes(1);

    startGridCharging.mockClear();

    // Tick 2 (a little later, still inside the same conflated charge run).
    // Telemetry hasn't yet caught up — still Load first — so state is NOT
    // satisfied. The write should be blocked by the 120s cooldown because the
    // range-aware signature is stable across every tick in the run.
    currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });
    await reconcileInverterState('tick 2');
    expect(startGridCharging).not.toHaveBeenCalled();
  });

  it('bypasses state satisfaction when telemetry is stale and re-issues the command', async () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    // State looks satisfied (Battery first + matching rate) but `last_updated`
    // is stale (> 60s old), so the watchdog must not trust it.
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 100,
      battery_first_grid_charge: 'Enabled',
      last_updated: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    await reconcileInverterState('stale telemetry');

    expect(startGridCharging).toHaveBeenCalledWith(100);
  });

  it('bypasses state satisfaction when last_updated is null', async () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    currentState = buildState({
      battery_soc: 40,
      work_mode: 'Battery first',
      battery_first_charge_rate: 100,
      battery_first_grid_charge: 'Enabled',
      last_updated: null,
    });

    await reconcileInverterState('null telemetry');

    expect(startGridCharging).toHaveBeenCalledWith(100);
  });

  describe('plan_slot_executions logging', () => {
    it('records an execution row on a charge command issuance', async () => {
      planSlotRow = {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      };
      currentState = buildState({ battery_soc: 42, work_mode: 'Load first' });

      await reconcileInverterState('tick 1');

      expect(startGridCharging).toHaveBeenCalledWith(100);
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);
      const row = recordSlotExecution.mock.calls[0][0];
      expect(row).toMatchObject({
        action: 'charge',
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        override_source: 'plan',
        soc_at_start: 42,
        soc_at_end: null,
      });
      expect(typeof row.command_signature).toBe('string');
      expect(row.command_signature).toContain('charge');
      expect(typeof row.command_issued_at).toBe('string');
    });

    it('does NOT record an execution when the state is already satisfied', async () => {
      planSlotRow = {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      };
      // State already reports the desired charge posture.
      currentState = buildState({
        battery_soc: 40,
        work_mode: 'Battery first',
        battery_first_charge_rate: 100,
        battery_first_grid_charge: 'Enabled',
      });

      await reconcileInverterState('state-satisfied charge');

      expect(startGridCharging).not.toHaveBeenCalled();
      expect(recordSlotExecution).not.toHaveBeenCalled();
    });

    it('does NOT record a second execution on a cooldown-blocked repeat tick', async () => {
      planSlotRow = {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      };
      // Tick 1: state not satisfied — command fires, row written.
      currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });
      await reconcileInverterState('tick 1');
      expect(startGridCharging).toHaveBeenCalledTimes(1);
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);

      startGridCharging.mockClear();

      // Tick 2 immediately after — telemetry hasn't caught up yet, so the
      // state is still unsatisfied but the 120s cooldown blocks the re-issue.
      currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });
      await reconcileInverterState('tick 2');

      expect(startGridCharging).not.toHaveBeenCalled();
      // Still only one recorded execution — the cooldown-blocked tick must
      // not append a new row.
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);
    });

    it('records override_source="manual" when a manual override drives the command', async () => {
      overrideRow = {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
      };
      currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });

      await reconcileInverterState('manual override updated');

      expect(startGridCharging).toHaveBeenCalledWith(100);
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);
      expect(recordSlotExecution.mock.calls[0][0]).toMatchObject({
        action: 'charge',
        override_source: 'manual',
      });
    });

    it('records override_source="auto" when an auto override drives the command', async () => {
      getCurrentAutoOverride.mockReturnValue({
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        source: 'soc_boost',
        reason: 'Auto SOC boost to recover from overnight drift.',
        expires_at: '2026-04-01T11:00:00Z',
      });
      currentState = buildState({ battery_soc: 30, work_mode: 'Load first' });

      await reconcileInverterState('auto override tick');

      expect(startGridCharging).toHaveBeenCalledWith(100);
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);
      expect(recordSlotExecution.mock.calls[0][0]).toMatchObject({
        action: 'charge',
        override_source: 'auto',
      });
    });

    it('backfills soc_at_end on the previous execution row when the range changes between ticks', async () => {
      // Tick 1: charge plan slot 10:00–10:30 at SOC 40.
      planSlotRow = {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      };
      currentState = buildState({ battery_soc: 40, work_mode: 'Load first' });

      await reconcileInverterState('tick 1 — slot A');
      expect(recordSlotExecution).toHaveBeenCalledTimes(1);

      // Arrange the backfill lookup: the next tick's resolve sees a different
      // range start, so the watchdog should look up the latest row for slot A
      // and update soc_at_end with the current SOC (75).
      getLatestExecutionForSlot.mockReturnValue({
        id: 42,
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        reason: 'scheduled_slot',
        override_source: 'plan',
        soc_at_start: 40,
        soc_at_end: null,
        command_signature: 'sig-a',
        command_issued_at: '2026-04-01T10:00:00.100Z',
      });

      // Tick 2: new slot at 10:30, different action → different range start.
      planSlotRow = {
        slot_start: '2026-04-01T10:30:00Z',
        slot_end: '2026-04-01T11:00:00Z',
        action: 'discharge',
        reason: 'Discharge slot selected by the arbitrage planner.',
      };
      // Move virtual time forward by overriding the clock mock — but since
      // getVirtualNow is stubbed to a constant, use the now-time alignment by
      // also returning the new plan slot from the stub. The resolver uses
      // getVirtualNow() as "now", so we need the plan slot to be active there.
      // The default virtual now is 2026-04-01T10:10:00Z — the new slot
      // (10:30–11:00) wouldn't be active yet. We can still trigger backfill
      // by reaching into resolve via a slot that's active at 10:10 but with a
      // different slot_start than 10:00. Instead, use a manual override for
      // 10:00:00Z–10:30:00Z that conflicts with slot A's range.
      //
      // Simpler: keep the same "now" and swap slot A for a manual override
      // starting at a different slot_start value so rangeStart differs.
      planSlotRow = null;
      overrideRow = {
        slot_start: '2026-04-01T10:05:00Z',
        slot_end: '2026-04-01T10:20:00Z',
        action: 'discharge',
      };
      currentState = buildState({ battery_soc: 75, work_mode: 'Battery first' });

      await reconcileInverterState('tick 2 — slot B');

      // Backfill should have been called for slot A's latest row with the
      // SOC observed at tick 2 (75).
      expect(getLatestExecutionForSlot).toHaveBeenCalledWith('2026-04-01T10:00:00Z');
      expect(updateSlotExecutionActuals).toHaveBeenCalledWith(42, { soc_at_end: 75 });
    });
  });
});
