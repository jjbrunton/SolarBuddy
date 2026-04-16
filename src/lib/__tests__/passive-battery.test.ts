import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, getSettingsMock, readingsAllMock, importRatesAllMock, exportRatesAllMock } =
  vi.hoisted(() => ({
    prepareMock: vi.fn(),
    getSettingsMock: vi.fn(),
    readingsAllMock: vi.fn(),
    importRatesAllMock: vi.fn(),
    exportRatesAllMock: vi.fn(),
  }));

vi.mock('../db', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

vi.mock('../config', () => ({
  getSettings: getSettingsMock,
}));

import { simulatePassiveBattery } from '../passive-battery';

// Each prepare() call returns an object whose `all` method is one of the
// three mocks above, dispatched by SQL text.
function wireDb() {
  prepareMock.mockImplementation((sql: string) => {
    if (sql.includes('FROM readings')) return { all: readingsAllMock };
    if (sql.includes('FROM rates')) return { all: importRatesAllMock };
    if (sql.includes('FROM export_rates')) return { all: exportRatesAllMock };
    return { all: () => [] };
  });
}

function settings(overrides: Record<string, string> = {}) {
  getSettingsMock.mockReturnValue({
    battery_capacity_kwh: '10',
    discharge_soc_floor: '10',
    max_charge_power_kw: '5',
    ...overrides,
  });
}

describe('simulatePassiveBattery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireDb();
    settings();
    importRatesAllMock.mockReturnValue([]);
    exportRatesAllMock.mockReturnValue([]);
  });

  it('returns empty summary when there are fewer than two readings', () => {
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-04-10T00:00:00.000Z', pv_power: 0, load_power: 500, battery_soc: 50 },
    ]);

    const { daily, summary } = simulatePassiveBattery('7d');

    expect(daily).toEqual([]);
    expect(summary.import_kwh).toBe(0);
    expect(summary.export_kwh).toBe(0);
    expect(summary.cost).toBe(0);
  });

  it('discharges the battery to cover load when solar is absent', () => {
    // Battery starts at 100% (10 kWh). Load is 1000W, no solar, 1h step.
    // Expect discharge, zero grid import on this first step (battery has plenty).
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-04-10T00:00:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 100 },
      { timestamp: '2026-04-10T00:05:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 100 },
    ]);

    const { summary } = simulatePassiveBattery('7d');

    expect(summary.starting_soc_pct).toBe(100);
    expect(summary.import_kwh).toBe(0);
    expect(summary.export_kwh).toBe(0);
  });

  it('exports the solar surplus when the battery is already full', () => {
    // Capacity 10kWh, starting at 100%. PV 3kW, load 500W, 5min step (dt=1/12h).
    // Surplus = 2.5kW × 1/12h ≈ 0.208 kWh. Battery is full, so all of it exports.
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-04-10T12:00:00.000Z', pv_power: 3000, load_power: 500, battery_soc: 100 },
      { timestamp: '2026-04-10T12:05:00.000Z', pv_power: 3000, load_power: 500, battery_soc: 100 },
    ]);

    const { summary } = simulatePassiveBattery('7d');

    expect(summary.import_kwh).toBe(0);
    expect(summary.export_kwh).toBeGreaterThan(0);
    expect(summary.export_kwh).toBeCloseTo(0.21, 1);
  });

  it('imports from the grid when the battery is depleted and there is no solar', () => {
    // Starting SOC = min floor. Load 1000W for 5min. No solar.
    // No battery available → all grid import.
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-04-10T22:00:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 10 },
      { timestamp: '2026-04-10T22:05:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 10 },
    ]);

    const { summary } = simulatePassiveBattery('7d');

    expect(summary.import_kwh).toBeGreaterThan(0);
    expect(summary.export_kwh).toBe(0);
    // 1000W × 5/60h = 0.0833 kWh expected
    expect(summary.import_kwh).toBeCloseTo(0.08, 1);
  });

  it('multiplies import/export kWh by the matching half-hour rate', () => {
    importRatesAllMock.mockReturnValue([
      { valid_from: '2026-04-10T22:00:00.000Z', price_inc_vat: 30 },
    ]);
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-04-10T22:00:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 10 },
      { timestamp: '2026-04-10T22:05:00.000Z', pv_power: 0, load_power: 1000, battery_soc: 10 },
    ]);

    const { summary } = simulatePassiveBattery('7d');

    // ~0.0833 kWh × 30p = ~2.5p
    expect(summary.cost).toBeGreaterThan(0);
    expect(summary.cost).toBeCloseTo(2.5, 0);
  });
});
