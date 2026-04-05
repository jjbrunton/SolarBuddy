import { describe, expect, it, vi } from 'vitest';

// Stub the usage repository so tests remain hermetic — the simulator's
// per-slot drain lookup would otherwise read the real DB profile if one
// has been populated by dev-server usage. Forcing the fallback path keeps
// the test's expected totals independent of any machine-specific profile.
vi.mock('../usage', () => ({
  getForecastedConsumptionW: (_: Date, fallbackW: number) => fallbackW,
  getAverageForecastedConsumptionW: (_start: number, _end: number, fallbackW: number) =>
    fallbackW,
}));

import { runFullSimulation } from '../simulator';

const { buildSchedulePlanMock } = vi.hoisted(() => ({
  buildSchedulePlanMock: vi.fn(),
}));

vi.mock('../scheduler/engine', () => ({
  buildSchedulePlan: buildSchedulePlanMock,
}));

describe('runFullSimulation', () => {
  it('replays planned charge, discharge, hold, and fallback slots', () => {
    buildSchedulePlanMock.mockReturnValue({
      slots: [
        { slot_start: '2026-04-03T00:00:00Z', action: 'charge', reason: 'cheap' },
        { slot_start: '2026-04-03T00:30:00Z', action: 'discharge', reason: 'expensive' },
        { slot_start: '2026-04-03T01:00:00Z', action: 'hold', reason: 'wait' },
        { slot_start: '2026-04-03T01:30:00Z', action: 'mystery', reason: 'fallback' },
      ],
      windows: [],
      slotsByDay: {},
      _dischargeDebug: { ok: true },
    });

    const settings = {
      battery_capacity_kwh: '10',
      max_charge_power_kw: '2',
      charge_rate: '100',
      estimated_consumption_w: '500',
    } as never;

    const result = runFullSimulation({
      rates: [
        { valid_from: '2026-04-03T00:00:00Z', valid_to: '2026-04-03T00:30:00Z', price_inc_vat: 10, price_exc_vat: 10 },
        { valid_from: '2026-04-03T00:30:00Z', valid_to: '2026-04-03T01:00:00Z', price_inc_vat: 20, price_exc_vat: 20 },
        { valid_from: '2026-04-03T01:00:00Z', valid_to: '2026-04-03T01:30:00Z', price_inc_vat: 30, price_exc_vat: 30 },
        { valid_from: '2026-04-03T01:30:00Z', valid_to: '2026-04-03T02:00:00Z', price_inc_vat: 40, price_exc_vat: 40 },
      ],
      exportRates: [
        { valid_from: '2026-04-03T00:30:00Z', valid_to: '2026-04-03T01:00:00Z', price_inc_vat: 50, price_exc_vat: 50 },
      ],
      pvForecast: [
        { valid_from: '2026-04-03T00:00:00Z', valid_to: '2026-04-03T00:30:00Z', pv_estimate_w: 0, pv_estimate10_w: 0, pv_estimate90_w: 0 },
        { valid_from: '2026-04-03T00:30:00Z', valid_to: '2026-04-03T01:00:00Z', pv_estimate_w: 1000, pv_estimate10_w: 800, pv_estimate90_w: 1200 },
        { valid_from: '2026-04-03T01:00:00Z', valid_to: '2026-04-03T01:30:00Z', pv_estimate_w: 600, pv_estimate10_w: 480, pv_estimate90_w: 720 },
        { valid_from: '2026-04-03T01:30:00Z', valid_to: '2026-04-03T02:00:00Z', pv_estimate_w: 100, pv_estimate10_w: 80, pv_estimate90_w: 120 },
      ],
      settings,
      startSoc: 50,
      now: new Date('2026-04-03T00:00:00Z'),
    });

    expect(buildSchedulePlanMock).toHaveBeenCalledWith(
      expect.any(Array),
      settings,
      expect.objectContaining({ currentSoc: 50, now: new Date('2026-04-03T00:00:00Z') }),
    );
    expect(result.summary).toEqual({
      total_import_cost: 10,
      total_export_revenue: 62.5,
      net_cost: -52.5,
      max_soc: 60,
      min_soc: 46,
      charge_slot_count: 1,
      discharge_slot_count: 1,
      hold_slot_count: 2,
      total_pv_kwh: 0.85,
      total_savings: 0,
      savings_range_low: 0,
      savings_range_high: 0,
    });
    expect(result.slots).toEqual([
      expect.objectContaining({
        action: 'charge',
        soc_before: 50,
        soc_after: 60,
        import_kwh: 1,
        export_kwh: 0,
        cost_pence: 10,
        revenue_pence: 0,
        pv_generation_kwh: 0,
        import_rate: 10,
        export_rate: 0,
      }),
      expect.objectContaining({
        action: 'discharge',
        soc_before: 60,
        soc_after: 47.5,
        import_kwh: 0,
        export_kwh: 1.25,
        cost_pence: 0,
        revenue_pence: 62.5,
        pv_generation_kwh: 0.5,
        import_rate: 20,
        export_rate: 50,
      }),
      expect.objectContaining({
        action: 'hold',
        soc_before: 47.5,
        soc_after: 48,
        pv_generation_kwh: 0.3,
      }),
      expect.objectContaining({
        action: 'mystery',
        soc_before: 48,
        soc_after: 46,
        pv_generation_kwh: 0.05,
      }),
    ]);
    expect(result.plan._dischargeDebug).toEqual({ ok: true });
  });

  it('falls back to default settings when configuration values are missing', () => {
    buildSchedulePlanMock.mockReturnValue({ slots: [], windows: [], slotsByDay: {} });

    const result = runFullSimulation({
      rates: [
        { valid_from: '2026-04-03T00:00:00Z', valid_to: '2026-04-03T00:30:00Z', price_inc_vat: 10, price_exc_vat: 10 },
      ],
      settings: {} as never,
      startSoc: 50,
    });

    expect(result.summary.total_import_cost).toBe(0);
    expect(result.summary.total_export_revenue).toBe(0);
    expect(result.summary.hold_slot_count).toBe(1);
  });
});
