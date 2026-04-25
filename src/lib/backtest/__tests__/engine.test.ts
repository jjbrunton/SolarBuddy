import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, simulatePassiveMock, getSettingsMock, buildPlanMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  simulatePassiveMock: vi.fn(),
  getSettingsMock: vi.fn(),
  buildPlanMock: vi.fn(),
}));

vi.mock('../../db', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

vi.mock('../../passive-battery', () => ({
  simulatePassiveBattery: simulatePassiveMock,
  calibrateRoundTripEfficiency: () => ({
    round_trip_efficiency: 0.9,
    source: 'fallback' as const,
    charge_kwh: 0,
    discharge_kwh: 0,
    soc_delta_kwh: 0,
    sample_count: 0,
  }),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('../../scheduler/engine', () => ({
  buildSchedulePlan: buildPlanMock,
}));

import {
  runBacktest,
  getWorstSlots,
  getBestSlots,
  getSchedulingEfficacy,
} from '../engine';

const BASE_SETTINGS = {
  battery_capacity_kwh: '10',
  max_charge_power_kw: '4',
  charge_rate: '100',
  discharge_soc_floor: '20',
  charging_strategy: 'night_fill',
  price_threshold: '0',
  charge_hours: '4',
  min_soc_target: '80',
} as Record<string, string>;

function mockQueryOrder(results: unknown[][]) {
  let i = 0;
  prepareMock.mockImplementation(() => ({
    all: () => results[i++] ?? [],
  }));
}

// SQL-text dispatch — robust against query reordering when new cache reads
// or plumbing queries get added inside scoreSlots/recompute paths. Use this
// for any test that exercises scoreSlots() and friends.
function mockBySql(handlers: {
  rates?: unknown[];
  exportRates?: unknown[];
  readings?: unknown[];
  planSlots?: unknown[];
  slotScoresCache?: unknown[];
  attributionDailyCache?: unknown[];
}) {
  prepareMock.mockImplementation((sql: string) => ({
    all: () => {
      if (sql.includes('FROM slot_scores_cache')) return handlers.slotScoresCache ?? [];
      if (sql.includes('FROM attribution_daily_cache')) return handlers.attributionDailyCache ?? [];
      if (sql.includes('FROM plan_slots')) return handlers.planSlots ?? [];
      if (sql.includes('FROM export_rates')) return handlers.exportRates ?? [];
      if (sql.includes('FROM rates')) return handlers.rates ?? [];
      if (sql.includes('FROM readings')) return handlers.readings ?? [];
      return [];
    },
    run: () => undefined,
  }));
  // db.transaction returns a function that runs the callback synchronously
  // — the cache writer uses it. With a stubbed Database we just no-op.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prepareMock as any).transaction = undefined;
}

describe('runBacktest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS });
    simulatePassiveMock.mockReturnValue({ daily: [], summary: {} });
  });

  it('returns empty result when there is no data', () => {
    mockQueryOrder([[], [], []]);
    const res = runBacktest({ fromISO: '2026-04-10T00:00:00Z', toISO: '2026-04-10T00:00:00Z' });
    expect(res.summary.days_covered).toBe(0);
    expect(res.daily).toEqual([]);
  });

  it('scores a charge slot that imports cheap energy and prices it correctly', () => {
    // One day with one half-hour slot @ 10p/kWh, load 1 kWh, no PV.
    // Plan: charge. Charge adds 4kW × 0.5h = 2 kWh from grid.
    // Net import = load - pv + charge = 1 - 0 + 2 = 3 kWh → cost = 30p.
    const rates = [
      { valid_from: '2026-04-10T00:00:00Z', valid_to: '2026-04-10T00:30:00Z', price_inc_vat: 10 },
    ];
    const exportRates = [
      { valid_from: '2026-04-10T00:00:00Z', valid_to: '2026-04-10T00:30:00Z', price_inc_vat: 5 },
    ];
    const readings = [
      { timestamp: '2026-04-10T00:05:00Z', load_power: 2000, pv_power: 0, grid_power: 2000, battery_soc: 50 },
      { timestamp: '2026-04-10T00:20:00Z', load_power: 2000, pv_power: 0, grid_power: 2000, battery_soc: 48 },
    ];
    mockQueryOrder([rates, exportRates, readings]);
    buildPlanMock.mockReturnValue({
      windows: [],
      slots: [
        {
          slot_start: '2026-04-10T00:00:00Z',
          slot_end: '2026-04-10T00:30:00Z',
          action: 'charge',
          reason: 'cheap',
          expected_soc_after: null,
          expected_value: null,
        },
      ],
    });
    simulatePassiveMock.mockReturnValue({
      daily: [{ date: '2026-04-10', import_kwh: 1, export_kwh: 0, cost: 10 }],
      summary: {},
    });

    const res = runBacktest({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
      includeSlots: true,
    });

    expect(res.summary.days_covered).toBe(1);
    expect(res.daily[0].charge_slots).toBe(1);
    expect(res.daily[0].import_kwh).toBeCloseTo(3, 5);
    // Net import 3 kWh × 10p = 30p. No export because load+charge > pv.
    expect(res.daily[0].actual_cost).toBeCloseTo(30, 5);
    // baseline_cost = load (1 kWh) × 10p = 10p
    expect(res.daily[0].baseline_cost).toBeCloseTo(10, 5);
    // passive = 10p → scheduling_saving = passive - actual = 10 - 30 = -20
    expect(res.daily[0].scheduling_saving).toBeCloseTo(-20, 5);
    expect(res.slots?.[0].action).toBe('charge');
  });

  it('applies settings overrides to the planner', () => {
    mockQueryOrder([[], [], []]);
    runBacktest({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
      settingsOverrides: { charging_strategy: 'opportunistic_topup', price_threshold: '15' },
    });
    // planner is not called with no data, so we only assert effective settings merge.
    // Call it via a scenario with data to confirm override propagation.
    prepareMock.mockReset();
    buildPlanMock.mockReset();
    const rates = [
      { valid_from: '2026-04-11T00:00:00Z', valid_to: '2026-04-11T00:30:00Z', price_inc_vat: 5 },
    ];
    const readings = [
      { timestamp: '2026-04-11T00:10:00Z', load_power: 1000, pv_power: 0, grid_power: 1000, battery_soc: 50 },
    ];
    mockQueryOrder([rates, [], readings]);
    buildPlanMock.mockReturnValue({
      windows: [],
      slots: [
        {
          slot_start: '2026-04-11T00:00:00Z',
          slot_end: '2026-04-11T00:30:00Z',
          action: 'hold',
          reason: 'x',
          expected_soc_after: null,
          expected_value: null,
        },
      ],
    });

    runBacktest({
      fromISO: '2026-04-11T00:00:00Z',
      toISO: '2026-04-11T00:00:00Z',
      settingsOverrides: { price_threshold: '15' },
    });

    const callArgs = buildPlanMock.mock.calls[0];
    expect(callArgs[1].price_threshold).toBe('15');
  });
});

describe('getWorstSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS });
  });

  it('returns empty when no readings', () => {
    mockBySql({});
    expect(getWorstSlots({ fromISO: '2026-04-10T00:00:00Z', toISO: '2026-04-10T00:00:00Z' })).toEqual([]);
  });

  it('ranks slots by positive delta (actual cost minus passive cost)', () => {
    // Slot A: PV surplus → passive would export, actual imported → big delta
    // Slot B: normal import at cheap rate → delta near zero
    const rates = [
      { valid_from: '2026-04-10T10:00:00Z', valid_to: '2026-04-10T10:30:00Z', price_inc_vat: 30 },
      { valid_from: '2026-04-10T11:00:00Z', valid_to: '2026-04-10T11:30:00Z', price_inc_vat: 10 },
    ];
    const exportRates = [
      { valid_from: '2026-04-10T10:00:00Z', valid_to: '2026-04-10T10:30:00Z', price_inc_vat: 15 },
    ];
    // Slot A at 10:00: load 1 kWh, pv 0, actual imported 1 kWh (plan didn't discharge).
    // Passive model with SOC=80% has battery available → would supply 1 kWh → import 0.
    // delta ≈ 1 * 30 - 0 = 30p.
    const readings = [
      { timestamp: '2026-04-10T10:10:00Z', load_power: 2000, pv_power: 0, grid_power: 2000, battery_soc: 80 },
      { timestamp: '2026-04-10T11:10:00Z', load_power: 400, pv_power: 0, grid_power: 400, battery_soc: 75 },
    ];
    mockBySql({ rates, exportRates, readings });
    const worst = getWorstSlots({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
      limit: 5,
    });
    expect(worst.length).toBeGreaterThan(0);
    expect(worst[0].slot_start).toBe('2026-04-10T10:00:00.000Z');
    expect(worst[0].delta).toBeGreaterThan(0);
  });
});

describe('getBestSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS });
  });

  it('returns slots sorted by ascending delta (biggest scheduler wins first)', () => {
    // Slot A: load 0.2 kWh, pv 0.5 kWh — passive would charge surplus into
    // the battery. If actual exported the surplus instead at a high export
    // rate, actual_cost is negative (revenue) and beats passive.
    const rates = [
      { valid_from: '2026-04-10T12:00:00Z', valid_to: '2026-04-10T12:30:00Z', price_inc_vat: 5 },
      { valid_from: '2026-04-10T18:00:00Z', valid_to: '2026-04-10T18:30:00Z', price_inc_vat: 30 },
    ];
    const exportRates = [
      { valid_from: '2026-04-10T12:00:00Z', valid_to: '2026-04-10T12:30:00Z', price_inc_vat: 25 },
    ];
    // Slot A: actual exported the PV surplus (good — high export rate),
    // passive would have stored it (no immediate revenue).
    // Slot B: bog-standard import, no scheduling difference.
    const readings = [
      { timestamp: '2026-04-10T12:10:00Z', load_power: 400, pv_power: 1000, grid_power: -600, battery_soc: 95 },
      { timestamp: '2026-04-10T18:10:00Z', load_power: 800, pv_power: 0, grid_power: 800, battery_soc: 30 },
    ];
    mockBySql({ rates, exportRates, readings });

    const best = getBestSlots({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
      limit: 5,
    });

    expect(best.length).toBeGreaterThan(0);
    expect(best[0].delta).toBeLessThanOrEqual(best[best.length - 1].delta);
  });
});

describe('getSchedulingEfficacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS });
  });

  it('returns zero summary when there is no data', () => {
    mockBySql({});
    const eff = getSchedulingEfficacy({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
    });
    expect(eff.total_slot_count).toBe(0);
    expect(eff.efficacy_pct).toBe(0);
    expect(eff.gross_wins_pence).toBe(0);
    expect(eff.gross_losses_pence).toBe(0);
  });

  it('decomposes net scheduling value into wins, losses, and an efficacy percentage', () => {
    const rates = [
      { valid_from: '2026-04-10T10:00:00Z', valid_to: '2026-04-10T10:30:00Z', price_inc_vat: 30 },
      { valid_from: '2026-04-10T11:00:00Z', valid_to: '2026-04-10T11:30:00Z', price_inc_vat: 30 },
    ];
    const exportRates: unknown[] = [];
    // Slot 1 (10:00): load 1 kWh, pv 0, actual imported 1 kWh — passive at
    // SOC=80% would have discharged. Actual costs more → loss.
    // Slot 2 (11:00): load 0.2 kWh, pv 0.2 kWh, actual perfectly balanced —
    // passive also balanced, delta ≈ 0 (neutral, excluded from ratio).
    const readings = [
      { timestamp: '2026-04-10T10:10:00Z', load_power: 2000, pv_power: 0, grid_power: 2000, battery_soc: 80 },
      { timestamp: '2026-04-10T11:10:00Z', load_power: 400, pv_power: 400, grid_power: 0, battery_soc: 75 },
    ];
    mockBySql({ rates, exportRates, readings });

    const eff = getSchedulingEfficacy({
      fromISO: '2026-04-10T00:00:00Z',
      toISO: '2026-04-10T00:00:00Z',
    });

    expect(eff.total_slot_count).toBeGreaterThan(0);
    expect(eff.loss_slot_count).toBeGreaterThanOrEqual(1);
    expect(eff.gross_losses_pence).toBeGreaterThan(0);
    expect(eff.net_pence).toBeLessThanOrEqual(0);
    // No wins → efficacy is 0% when activity exists but is all losses.
    if (eff.gross_wins_pence === 0 && eff.gross_losses_pence > 0) {
      expect(eff.efficacy_pct).toBe(0);
    }
  });
});
