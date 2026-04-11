import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';
import type { PlanAction } from '../../plan-actions';
import type { InverterState } from '../../types';

type OverrideRow = {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
};

type AutoOverrideRecord = {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  source: 'soc_boost' | 'battery_exhausted_guard' | 'manual_expired';
  reason: string;
  expires_at: string;
};

type PlanSlotRow = {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string | null;
};

let overrideRow: OverrideRow | null = null;
let autoOverrideRows: AutoOverrideRecord[] = [];
let planSlotRow: PlanSlotRow | null = null;
let planSlotRows: PlanSlotRow[] = [];
let scheduledActionResult: { action: PlanAction; reason: string } | null = null;
let scheduledActionLookup:
  | ((now: Date, soc: number | null) => { action: PlanAction; reason: string } | null)
  | null = null;

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
      get: (a?: string, b?: string, c?: string) => {
        if (sql.includes('FROM manual_overrides')) {
          // The resolver queries `slot_start <= ? AND slot_end > ?` with the
          // same timestamp twice. Only return overrideRow when that timestamp
          // actually intersects the override's window.
          if (!overrideRow) return null;
          const ts = a ?? b;
          if (!ts) return overrideRow;
          if (ts >= overrideRow.slot_start && ts < overrideRow.slot_end) {
            return overrideRow;
          }
          return null;
        }
        if (sql.includes('FROM auto_overrides')) {
          // Repository queries slot_start <= ? AND slot_end > ? AND expires_at > ?
          const ts = a ?? b ?? c;
          if (!ts) return autoOverrideRows[0] ?? null;
          const match = autoOverrideRows.find(
            (r) => ts >= r.slot_start && ts < r.slot_end && r.expires_at > ts,
          );
          return match ?? null;
        }
        if (sql.includes('FROM plan_slots') && sql.includes('slot_start <=')) {
          return planSlotRow;
        }
        return null;
      },
      all: (_a?: string, _b?: number) => {
        if (sql.includes('FROM plan_slots') && sql.includes('slot_end >')) {
          return planSlotRows;
        }
        return [];
      },
    }),
  }),
}));

vi.mock('../../db/auto-override-repository', () => ({
  getCurrentAutoOverride: (nowIso: string) => {
    const match = autoOverrideRows.find(
      (r) => nowIso >= r.slot_start && nowIso < r.slot_end && r.expires_at > nowIso,
    );
    return match ?? null;
  },
}));

vi.mock('../../scheduled-actions', () => ({
  evaluateScheduledActions: (now: Date, soc: number | null) => {
    if (scheduledActionLookup) return scheduledActionLookup(now, soc);
    return scheduledActionResult;
  },
}));

// Stub out the usage module to keep the resolve tests hermetic — the real
// module transitively hits the DB and pulls in unrelated WIP code.
vi.mock('../../usage', () => ({
  getForecastedConsumptionW: () => 0,
  getBaseloadW: () => 0,
  getAverageForecastedConsumptionW: () => 0,
  getUsageHighPeriods: () => [],
  getUsageProfile: () => null,
  invalidateUsageProfileCache: () => {},
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  getVirtualCurrentPlanSlot: () => null,
  isVirtualModeEnabled: () => false,
}));

import { resolveSlotAction, resolveSlotActionRange, resolveUpcomingEvents } from '../resolve';

describe('resolveSlotAction', () => {
  const now = new Date('2026-04-01T10:10:00Z');

  beforeEach(() => {
    overrideRow = null;
    autoOverrideRows = [];
    planSlotRow = null;
    planSlotRows = [];
    scheduledActionResult = null;
    scheduledActionLookup = null;
  });

  it('returns source "manual" when a manual override is active', () => {
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

    const result = resolveSlotAction(now, buildState(), buildSettings());

    expect(result).toEqual({
      action: 'hold',
      source: 'manual',
      reason: 'manual_override',
      detail: 'Manual override hold is active for the current slot.',
      slotStart: '2026-04-01T10:00:00Z',
      slotEnd: '2026-04-01T10:30:00Z',
    });
  });

  it('returns source "scheduled" when a user-defined scheduled action fires', () => {
    scheduledActionResult = {
      action: 'discharge',
      reason: 'Scheduled action "Peak shave": discharge (unconditional)',
    };
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    const result = resolveSlotAction(now, buildState(), buildSettings());

    expect(result).toMatchObject({
      action: 'discharge',
      source: 'scheduled',
      reason: 'scheduled_action',
      detail: 'Scheduled action "Peak shave": discharge (unconditional)',
    });
    // Scheduled actions intentionally do not expose slot_start/slot_end
    expect(result.slotStart).toBeUndefined();
    expect(result.slotEnd).toBeUndefined();
  });

  it('returns source "plan" when an active plan slot applies and no holds trigger', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    const result = resolveSlotAction(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result).toEqual({
      action: 'charge',
      source: 'plan',
      reason: 'scheduled_slot',
      detail: 'Charge slot selected by the planner.',
      slotStart: '2026-04-01T10:00:00Z',
      slotEnd: '2026-04-01T10:30:00Z',
    });
  });

  it('returns source "target_soc" when a charge slot fires but SOC is at/above target', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    const result = resolveSlotAction(
      now,
      buildState({ battery_soc: 85 }),
      buildSettings({ min_soc_target: '80' }),
    );

    expect(result).toEqual({
      action: 'hold',
      source: 'target_soc',
      reason: 'target_soc_reached',
      detail: 'Scheduled charge window is active, but battery SOC is already at or above 80%. Holding.',
      slotStart: '2026-04-01T10:00:00Z',
      slotEnd: '2026-04-01T10:30:00Z',
    });
  });

  it('returns source "solar_surplus" when an opportunistic top-up window overlaps solar surplus', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };

    const result = resolveSlotAction(
      now,
      buildState({
        battery_soc: 60,
        pv_power: 1800,
        load_power: 400,
        grid_power: -300,
        battery_power: 150,
      }),
      buildSettings({ charging_strategy: 'opportunistic_topup' }),
    );

    expect(result).toEqual({
      action: 'hold',
      source: 'solar_surplus',
      reason: 'solar_surplus',
      detail: 'Scheduled opportunistic top-up window is active, but solar surplus is already charging the battery. Holding.',
      slotStart: '2026-04-01T10:00:00Z',
      slotEnd: '2026-04-01T10:30:00Z',
    });
  });

  it('does not apply the solar-surplus hold for negative-price charge slots', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Negative-price window: charge aggressively.',
    };

    const result = resolveSlotAction(
      now,
      buildState({
        battery_soc: 60,
        pv_power: 1800,
        load_power: 400,
        grid_power: -300,
        battery_power: 150,
      }),
      buildSettings({ charging_strategy: 'opportunistic_topup' }),
    );

    expect(result.source).toBe('plan');
    expect(result.action).toBe('charge');
  });

  it('returns source "default" when nothing applies', () => {
    const result = resolveSlotAction(now, buildState(), buildSettings());

    expect(result).toEqual({
      action: 'hold',
      source: 'default',
      reason: 'default_mode',
      detail: 'No active override or schedule window applies right now. Holding battery at current SOC.',
    });
  });

  it('returns source "auto" when an auto override is active', () => {
    autoOverrideRows = [
      {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        source: 'soc_boost',
        reason: 'SOC 15% below always-charge threshold 30%',
        expires_at: '2026-04-01T10:30:00Z',
      },
    ];

    const result = resolveSlotAction(now, buildState({ battery_soc: 15 }), buildSettings());

    expect(result).toEqual({
      action: 'charge',
      source: 'auto',
      reason: 'auto_override:soc_boost',
      detail: 'SOC 15% below always-charge threshold 30%',
      slotStart: '2026-04-01T10:00:00Z',
      slotEnd: '2026-04-01T10:30:00Z',
    });
  });

  it('manual override wins over an auto override', () => {
    overrideRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'discharge',
    };
    autoOverrideRows = [
      {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'charge',
        source: 'soc_boost',
        reason: 'SOC boost',
        expires_at: '2026-04-01T10:30:00Z',
      },
    ];

    const result = resolveSlotAction(now, buildState({ battery_soc: 15 }), buildSettings());

    expect(result.source).toBe('manual');
    expect(result.action).toBe('discharge');
  });

  it('auto override wins over a scheduled action', () => {
    scheduledActionResult = {
      action: 'discharge',
      reason: 'Scheduled action "Peak shave": discharge (unconditional)',
    };
    autoOverrideRows = [
      {
        slot_start: '2026-04-01T10:00:00Z',
        slot_end: '2026-04-01T10:30:00Z',
        action: 'hold',
        source: 'battery_exhausted_guard',
        reason: 'SOC at discharge floor',
        expires_at: '2026-04-01T10:30:00Z',
      },
    ];

    const result = resolveSlotAction(now, buildState({ battery_soc: 20 }), buildSettings());

    expect(result.source).toBe('auto');
    expect(result.action).toBe('hold');
    expect(result.reason).toBe('auto_override:battery_exhausted_guard');
  });
});

describe('resolveSlotActionRange', () => {
  const now = new Date('2026-04-01T10:10:00Z');

  beforeEach(() => {
    overrideRow = null;
    autoOverrideRows = [];
    planSlotRow = null;
    planSlotRows = [];
    scheduledActionResult = null;
    scheduledActionLookup = null;
  });

  it('returns a single-slot range when only one charge plan slot exists', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    planSlotRows = [planSlotRow];

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.source).toBe('plan');
    expect(result.action).toBe('charge');
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
    expect(result.slotsInRange).toBe(1);
  });

  it('conflates four contiguous charge plan slots into one range', () => {
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
      {
        slot_start: '2026-04-01T11:30:00Z',
        slot_end: '2026-04-01T12:00:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      },
    ];

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T12:00:00Z');
    expect(result.slotsInRange).toBe(4);
  });

  it('stops conflation at the first action change', () => {
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
        action: 'discharge',
        reason: 'Discharge slot selected by the arbitrage planner.',
      },
    ];

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.action).toBe('charge');
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T11:00:00Z');
    expect(result.slotsInRange).toBe(2);
  });

  it('stops conflation at a time discontinuity in the plan slots', () => {
    planSlotRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'charge',
      reason: 'Charge slot selected by the planner.',
    };
    planSlotRows = [
      planSlotRow,
      // Gap: next slot starts an hour later, not at 10:30
      {
        slot_start: '2026-04-01T11:30:00Z',
        slot_end: '2026-04-01T12:00:00Z',
        action: 'charge',
        reason: 'Charge slot selected by the planner.',
      },
    ];

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
    expect(result.slotsInRange).toBe(1);
  });

  it('stops conflation when a manual override would cover a future slot', () => {
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
    // Override covers only the 10:30–11:00 slot. The current resolution at
    // 10:10 still picks up the charge plan slot, but the walk must stop when
    // it reaches the overridden 10:30 boundary.
    overrideRow = {
      slot_start: '2026-04-01T10:30:00Z',
      slot_end: '2026-04-01T11:00:00Z',
      action: 'hold',
    };

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.source).toBe('plan');
    expect(result.action).toBe('charge');
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
    expect(result.slotsInRange).toBe(1);
  });

  it('stops conflation when a scheduled action would fire at a future slot boundary', () => {
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
    // Scheduled action only fires at 11:00 — walk should stop before it.
    scheduledActionLookup = (lookupNow) => {
      if (lookupNow.getTime() === new Date('2026-04-01T11:00:00Z').getTime()) {
        return { action: 'discharge', reason: 'Peak-shave scheduled action fires at 11:00' };
      }
      return null;
    };

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.action).toBe('charge');
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T11:00:00Z');
    expect(result.slotsInRange).toBe(2);
  });

  it('returns a single-slot range when the source is target_soc (hold)', () => {
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
    ];

    // SOC already at target — resolved source flips to target_soc hold, and
    // ranges must not span across multiple plan slots for dynamic sources.
    const result = resolveSlotActionRange(
      now,
      buildState({ battery_soc: 90 }),
      buildSettings({ min_soc_target: '80' }),
    );

    expect(result.source).toBe('target_soc');
    expect(result.action).toBe('hold');
    expect(result.slotsInRange).toBe(1);
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
  });

  it('returns a single-slot range when no plan slot applies (default hold)', () => {
    const result = resolveSlotActionRange(now, buildState(), buildSettings());

    expect(result.source).toBe('default');
    expect(result.action).toBe('hold');
    expect(result.slotsInRange).toBe(1);
    // rangeStart/rangeEnd default to now + 30min for default holds.
    expect(result.rangeStart).toBe(now.toISOString());
    expect(new Date(result.rangeEnd).getTime()).toBeGreaterThan(new Date(result.rangeStart).getTime());
  });

  it('returns a single-slot range when a manual override is active', () => {
    overrideRow = {
      slot_start: '2026-04-01T10:00:00Z',
      slot_end: '2026-04-01T10:30:00Z',
      action: 'discharge',
    };

    const result = resolveSlotActionRange(now, buildState(), buildSettings());

    expect(result.source).toBe('manual');
    expect(result.action).toBe('discharge');
    expect(result.slotsInRange).toBe(1);
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
  });

  it('stops conflation when an auto override covers a future slot', () => {
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
    // Auto override covers only the 10:30–11:00 slot. The current resolution
    // at 10:10 still picks up the charge plan slot, but the walk must stop
    // when it reaches the auto-overridden 10:30 boundary.
    autoOverrideRows = [
      {
        slot_start: '2026-04-01T10:30:00Z',
        slot_end: '2026-04-01T11:00:00Z',
        action: 'hold',
        source: 'battery_exhausted_guard',
        reason: 'SOC at floor',
        expires_at: '2026-04-01T11:00:00Z',
      },
    ];

    const result = resolveSlotActionRange(now, buildState({ battery_soc: 40 }), buildSettings());

    expect(result.source).toBe('plan');
    expect(result.action).toBe('charge');
    expect(result.rangeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.rangeEnd).toBe('2026-04-01T10:30:00Z');
    expect(result.slotsInRange).toBe(1);
  });
});

describe('resolveUpcomingEvents', () => {
  const now = new Date('2026-04-01T10:10:00Z');

  beforeEach(() => {
    overrideRow = null;
    autoOverrideRows = [];
    planSlotRow = null;
    planSlotRows = [];
    scheduledActionResult = null;
    scheduledActionLookup = null;
  });

  it('returns null fields when there are no upcoming plan slots', () => {
    const result = resolveUpcomingEvents(now, null);
    expect(result).toEqual({
      nextAction: null,
      nextActionStart: null,
      nextChargeStart: null,
      nextDischargeStart: null,
    });
  });

  it('skips the leading run of slots matching the current action when finding nextAction', () => {
    planSlotRows = [
      // Two contiguous charge slots — the current run.
      { slot_start: '2026-04-01T10:00:00Z', slot_end: '2026-04-01T10:30:00Z', action: 'charge', reason: null },
      { slot_start: '2026-04-01T10:30:00Z', slot_end: '2026-04-01T11:00:00Z', action: 'charge', reason: null },
      // Then a discharge slot — should be reported as nextAction.
      { slot_start: '2026-04-01T11:00:00Z', slot_end: '2026-04-01T11:30:00Z', action: 'discharge', reason: null },
      { slot_start: '2026-04-01T11:30:00Z', slot_end: '2026-04-01T12:00:00Z', action: 'hold', reason: null },
      // And a later charge run.
      { slot_start: '2026-04-01T23:00:00Z', slot_end: '2026-04-01T23:30:00Z', action: 'charge', reason: null },
    ];

    const result = resolveUpcomingEvents(now, 'charge');

    expect(result.nextAction).toBe('discharge');
    expect(result.nextActionStart).toBe('2026-04-01T11:00:00Z');
    expect(result.nextDischargeStart).toBe('2026-04-01T11:00:00Z');
    expect(result.nextChargeStart).toBe('2026-04-01T23:00:00Z');
  });

  it('does not skip when currentAction is null (e.g. no resolved action yet)', () => {
    planSlotRows = [
      { slot_start: '2026-04-01T10:00:00Z', slot_end: '2026-04-01T10:30:00Z', action: 'charge', reason: null },
      { slot_start: '2026-04-01T10:30:00Z', slot_end: '2026-04-01T11:00:00Z', action: 'discharge', reason: null },
    ];

    const result = resolveUpcomingEvents(now, null);

    expect(result.nextAction).toBe('charge');
    expect(result.nextActionStart).toBe('2026-04-01T10:00:00Z');
    expect(result.nextChargeStart).toBe('2026-04-01T10:00:00Z');
    expect(result.nextDischargeStart).toBe('2026-04-01T10:30:00Z');
  });

  it('reports null next-charge / next-discharge when no such slot exists in the upcoming window', () => {
    planSlotRows = [
      { slot_start: '2026-04-01T10:00:00Z', slot_end: '2026-04-01T10:30:00Z', action: 'hold', reason: null },
      { slot_start: '2026-04-01T10:30:00Z', slot_end: '2026-04-01T11:00:00Z', action: 'discharge', reason: null },
    ];

    const result = resolveUpcomingEvents(now, 'hold');

    expect(result.nextChargeStart).toBeNull();
    expect(result.nextDischargeStart).toBe('2026-04-01T10:30:00Z');
  });
});
