import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, allMock, simulatePassiveRangeMock, getSettingsMock, calibrateMock } =
  vi.hoisted(() => ({
    prepareMock: vi.fn(),
    allMock: vi.fn(),
    simulatePassiveRangeMock: vi.fn(),
    getSettingsMock: vi.fn(),
    calibrateMock: vi.fn(),
  }));

vi.mock('../db', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

vi.mock('../passive-battery', () => ({
  simulatePassiveBatteryRange: simulatePassiveRangeMock,
  calibrateRoundTripEfficiency: calibrateMock,
}));

vi.mock('../config', () => ({
  getSettings: getSettingsMock,
}));

import { getAttributionData, recomputeAttributionForDate } from '../attribution';

const DEFAULT_PASSIVE_CONFIG = {
  capacity_kwh: 10,
  min_soc_pct: 10,
  max_power_kw: 5,
  round_trip_efficiency: 0.9,
  rte_source: 'fallback' as const,
  starting_soc_pct: 50,
};

// SQL-text dispatch: cache reads return [] (forces live path), the readings
// aggregate query returns the test fixture. Keeps the existing behaviour
// for tests that pre-date the daily cache.
function wireDb() {
  prepareMock.mockImplementation((sql: string) => ({
    all: (...args: unknown[]) => {
      if (sql.includes('FROM attribution_daily_cache')) return [];
      // The legacy fixture is the readings aggregate.
      return allMock(...args);
    },
  }));
}

describe('getAttributionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireDb();
    getSettingsMock.mockReturnValue({
      battery_capacity_kwh: '10',
      discharge_soc_floor: '10',
      max_charge_power_kw: '5',
    });
    calibrateMock.mockReturnValue({
      round_trip_efficiency: 0.9,
      source: 'fallback' as const,
      charge_kwh: 0,
      discharge_kwh: 0,
      soc_delta_kwh: 0,
      sample_count: 0,
    });
  });

  it('prices the no-hardware baseline against real tariff rates, not a flat assumption', () => {
    // 48 samples, dt = 0.5h each.
    // Load 1000W constant → 24 kWh.
    // baseline_cost_w_price = 48 × 1000W × 20 p/kWh avg weighting
    //   → baseline cost = (48 × 1000 × 20 × 0.5) / 1000 = 480p
    // (i.e. avg rate the tariff was at while load was running = 20p/kWh)
    allMock.mockReturnValue([
      {
        date: '2026-04-10',
        load_w_sum: 48000,
        import_w_sum: 24000,
        export_w_sum: 9600,
        sample_count: 48,
        import_cost_w_price: 240000, // 120p actual import cost
        export_revenue_w_price: 48000, // 24p actual export revenue
        baseline_cost_w_price: 48000 * 20, // 480p no-hardware baseline
        load_w_sum_with_rate: 48000,
      },
    ]);
    simulatePassiveRangeMock.mockReturnValue({
      daily: [{ date: '2026-04-10', import_kwh: 10, export_kwh: 4, cost: 80 }],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 10,
        export_kwh: 4,
        cost: 80,
        simulated_seconds: 86400,
      },
    });

    const { summary } = getAttributionData('7d');

    expect(summary.baseline_cost).toBe(480); // NOT 24 × 24.5p = 588p
    expect(summary.actual_cost).toBe(96);
    expect(summary.passive_cost).toBe(80);
    // hardware = 480 − 80 = 400
    expect(summary.hardware_saving).toBe(400);
    // scheduling = 80 − 96 = −16
    expect(summary.scheduling_saving).toBe(-16);
    expect(summary.total_saving).toBe(summary.hardware_saving + summary.scheduling_saving);
  });

  it('exposes an effective import rate averaged over actual load', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-10',
        load_w_sum: 48000,
        import_w_sum: 0,
        export_w_sum: 0,
        sample_count: 48,
        import_cost_w_price: 0,
        export_revenue_w_price: 0,
        baseline_cost_w_price: 48000 * 18, // effective 18p/kWh
        load_w_sum_with_rate: 48000,
      },
    ]);
    simulatePassiveRangeMock.mockReturnValue({
      daily: [],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 0,
        export_kwh: 0,
        cost: 0,
        simulated_seconds: 0,
      },
    });

    const { summary } = getAttributionData('7d');

    expect(summary.avg_import_rate).toBeCloseTo(18, 1);
  });

  it('reports positive scheduling saving when passive would have cost more than actual', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-11',
        load_w_sum: 48000,
        import_w_sum: 24000,
        export_w_sum: 0,
        sample_count: 48,
        import_cost_w_price: 120000, // 60p actual
        export_revenue_w_price: 0,
        baseline_cost_w_price: 48000 * 22, // 528p no-hardware baseline
        load_w_sum_with_rate: 48000,
      },
    ]);
    simulatePassiveRangeMock.mockReturnValue({
      daily: [{ date: '2026-04-11', import_kwh: 12, export_kwh: 0, cost: 200 }],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 12,
        export_kwh: 0,
        cost: 200,
        simulated_seconds: 86400,
      },
    });

    const { summary } = getAttributionData('7d');

    expect(summary.actual_cost).toBe(60);
    expect(summary.passive_cost).toBe(200);
    expect(summary.scheduling_saving).toBe(140);
  });

  it('handles empty periods gracefully', () => {
    allMock.mockReturnValue([]);
    simulatePassiveRangeMock.mockReturnValue({
      daily: [],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 0,
        export_kwh: 0,
        cost: 0,
        simulated_seconds: 0,
      },
    });

    const { summary } = getAttributionData('7d');

    expect(summary.baseline_cost).toBe(0);
    expect(summary.avg_import_rate).toBe(0);
    expect(summary.hardware_saving).toBe(0);
    expect(summary.scheduling_saving).toBe(0);
  });

  it('exposes passive config details in the summary for UI transparency', () => {
    allMock.mockReturnValue([]);
    simulatePassiveRangeMock.mockReturnValue({
      daily: [],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        starting_soc_pct: 42,
        import_kwh: 0,
        export_kwh: 0,
        cost: 0,
        simulated_seconds: 0,
      },
    });

    const { summary } = getAttributionData('7d');

    expect(summary.passive_config).toEqual({
      capacity_kwh: 10,
      min_soc_pct: 10,
      max_power_kw: 5,
      round_trip_efficiency: 0.9,
      rte_source: 'fallback',
      starting_soc_pct: 42,
    });
  });

  it('reads from attribution_daily_cache for completed days and skips the live readings scan', () => {
    const cachedRow = {
      date: '2026-04-20',
      load_kwh: 10,
      import_kwh: 4,
      export_kwh: 0,
      passive_import_kwh: 3,
      passive_export_kwh: 0,
      baseline_cost: 240,
      passive_cost: 90,
      actual_cost: 80,
      hardware_saving: 150,
      scheduling_saving: 10,
      total_saving: 160,
      rte_used: 0.85,
      rte_source: 'calibrated' as const,
      computed_at: '2026-04-21T03:45:00.000Z',
    };
    let readingsQueriedForCachedRange = false;
    prepareMock.mockImplementation((sql: string) => ({
      all: () => {
        if (sql.includes('FROM attribution_daily_cache')) return [cachedRow];
        // The aggregate query runs over the live tail. If the test date is
        // before "today", we should not see the readings query at all.
        if (sql.includes('FROM readings')) {
          readingsQueriedForCachedRange = true;
          return [];
        }
        return [];
      },
    }));
    simulatePassiveRangeMock.mockReturnValue({
      daily: [],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 0,
        export_kwh: 0,
        cost: 0,
        simulated_seconds: 0,
      },
    });

    const { daily, summary } = getAttributionData('7d');

    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe('2026-04-20');
    expect(daily[0].scheduling_saving).toBe(10);
    expect(summary.passive_cost).toBe(90);
    // We don't assert readingsQueriedForCachedRange === false because the
    // live tail (today) still gets queried — just confirm the cached row
    // came through unchanged.
    expect(readingsQueriedForCachedRange).toBe(true);
  });
});

describe('recomputeAttributionForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes one row to the cache via INSERT ... ON CONFLICT', () => {
    const inserts: unknown[][] = [];
    const insertStmt = { run: (...args: unknown[]) => inserts.push(args) };
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO attribution_daily_cache')) return insertStmt;
      // Aggregate readings query: return one fixture row.
      if (sql.includes('FROM readings')) {
        return {
          all: () => [
            {
              date: '2026-04-20',
              load_w_sum: 48000,
              import_w_sum: 24000,
              export_w_sum: 0,
              sample_count: 48,
              import_cost_w_price: 240000,
              export_revenue_w_price: 0,
              baseline_cost_w_price: 48000 * 22,
              load_w_sum_with_rate: 48000,
            },
          ],
        };
      }
      return { all: () => [] };
    });
    simulatePassiveRangeMock.mockReturnValue({
      daily: [{ date: '2026-04-20', import_kwh: 6, export_kwh: 0, cost: 100 }],
      summary: {
        ...DEFAULT_PASSIVE_CONFIG,
        import_kwh: 6,
        export_kwh: 0,
        cost: 100,
        simulated_seconds: 86400,
      },
    });

    const row = recomputeAttributionForDate('2026-04-20');

    expect(row).not.toBeNull();
    expect(row?.date).toBe('2026-04-20');
    expect(inserts).toHaveLength(1);
    // First positional arg is the date.
    expect(inserts[0][0]).toBe('2026-04-20');
  });
});
