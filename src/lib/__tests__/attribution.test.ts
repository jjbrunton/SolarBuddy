import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, allMock, simulatePassiveMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  simulatePassiveMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

vi.mock('../passive-battery', () => ({
  simulatePassiveBattery: simulatePassiveMock,
}));

import { getAttributionData } from '../attribution';

const DEFAULT_PASSIVE_CONFIG = {
  capacity_kwh: 10,
  min_soc_pct: 10,
  max_power_kw: 5,
  round_trip_efficiency: 0.9,
  starting_soc_pct: 50,
};

describe('getAttributionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({ all: allMock });
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
    simulatePassiveMock.mockReturnValue({
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
    simulatePassiveMock.mockReturnValue({
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
    simulatePassiveMock.mockReturnValue({
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
    simulatePassiveMock.mockReturnValue({
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
    simulatePassiveMock.mockReturnValue({
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
      starting_soc_pct: 42,
    });
  });
});
