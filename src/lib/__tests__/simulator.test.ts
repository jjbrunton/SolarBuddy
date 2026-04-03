import { describe, expect, it, vi } from 'vitest';
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
      total_export_revenue: 37.5,
      net_cost: -27.5,
      max_soc: 60,
      min_soc: 50,
      charge_slot_count: 1,
      discharge_slot_count: 1,
      hold_slot_count: 2,
      total_pv_kwh: 0.85,
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
        export_rate: 10,
      }),
      expect.objectContaining({
        action: 'discharge',
        soc_before: 60,
        soc_after: 52.5,
        import_kwh: 0,
        export_kwh: 0.75,
        cost_pence: 0,
        revenue_pence: 37.5,
        pv_generation_kwh: 0.5,
        import_rate: 20,
        export_rate: 50,
      }),
      expect.objectContaining({
        action: 'hold',
        soc_before: 52.5,
        soc_after: 53,
        pv_generation_kwh: 0.3,
      }),
      expect.objectContaining({
        action: 'mystery',
        soc_before: 53,
        soc_after: 51,
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
