import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  prepareMock,
  allMock,
  getMock,
  getStoredImportRatesMock,
  getStoredExportRatesMock,
  getStoredPVForecastMock,
  getForecastedConsumptionWMock,
  getSettingsMock,
  getDailyPnLMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  getMock: vi.fn(),
  getStoredImportRatesMock: vi.fn(),
  getStoredExportRatesMock: vi.fn(),
  getStoredPVForecastMock: vi.fn(),
  getForecastedConsumptionWMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getDailyPnLMock: vi.fn(),
}));

vi.mock('../db', () => ({ getDb: getDbMock }));
vi.mock('../db/rate-repository', () => ({
  getStoredImportRates: getStoredImportRatesMock,
  getStoredExportRates: getStoredExportRatesMock,
}));
vi.mock('../solcast/store', () => ({
  getStoredPVForecast: getStoredPVForecastMock,
}));
vi.mock('../usage/repository', () => ({
  getForecastedConsumptionW: getForecastedConsumptionWMock,
}));
vi.mock('../config', () => ({
  getSettings: getSettingsMock,
}));
vi.mock('../accounting', () => ({
  getDailyPnL: getDailyPnLMock,
}));

import { getEstimatedBill } from '../bill-estimate';

function slotsForDay(dayIso: string, importPrice = 20, exportPrice = 5) {
  // 48 half-hour slots covering the full day in local time — getEstimatedBill()
  // uses local midnight boundaries (setHours(0,0,0,0)) for today/tomorrow, so
  // fixture slots must align with local time to match regardless of TZ.
  const [y, m, d] = dayIso.split('-').map(Number);
  const rates: Array<{ valid_from: string; valid_to: string; price_inc_vat: number; price_exc_vat: number }> = [];
  for (let i = 0; i < 48; i++) {
    const start = new Date(y, m - 1, d, 0, i * 30);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    rates.push({
      valid_from: start.toISOString(),
      valid_to: end.toISOString(),
      price_inc_vat: importPrice,
      price_exc_vat: importPrice,
    });
  }
  return rates.map((r) => ({ ...r })); // shallow clones
}

beforeEach(() => {
  vi.useFakeTimers();
  // Use a fixed UTC midnight so local-time and UTC-time match in the test env.
  vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

  vi.clearAllMocks();
  getDbMock.mockReturnValue({ prepare: prepareMock });
  prepareMock.mockReturnValue({ all: allMock, get: getMock });
  allMock.mockReturnValue([]); // no plan slots by default
  getMock.mockReturnValue(undefined); // no last reading

  getStoredImportRatesMock.mockReturnValue([]);
  getStoredExportRatesMock.mockReturnValue([]);
  getStoredPVForecastMock.mockReturnValue([]);
  getForecastedConsumptionWMock.mockImplementation((_ts: Date, fallback: number) => fallback);
  getSettingsMock.mockReturnValue({
    estimated_consumption_w: '500',
    max_charge_power_kw: '3.6',
    export_rate: '0',
  });
  getDailyPnLMock.mockReturnValue({ daily: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getEstimatedBill — today + tomorrow summary shape', () => {
  it('returns today and tomorrow estimates with generated_at timestamp', () => {
    const result = getEstimatedBill();
    expect(result.today.date).toBe('2026-04-10');
    expect(result.tomorrow.date).toBe('2026-04-11');
    expect(typeof result.generated_at).toBe('string');
  });
});

describe('getEstimatedBill — forecasting logic', () => {
  it('returns zero cost when there are no rates, no PV, and no readings', () => {
    const result = getEstimatedBill();
    expect(result.today.total_cost_pence).toBe(0);
    expect(result.tomorrow.total_cost_pence).toBe(0);
    expect(result.tomorrow.import_kwh).toBe(0);
    expect(result.tomorrow.export_kwh).toBe(0);
  });

  it('imports from the grid across every slot during pure hold with no PV', () => {
    const rates = [...slotsForDay('2026-04-10', 20), ...slotsForDay('2026-04-11', 20)];
    getStoredImportRatesMock.mockReturnValue(rates);

    // 500W load × 0.5h × 48 slots / 1000 = 12 kWh, × 20p = 240p — per day.
    const result = getEstimatedBill();
    expect(result.tomorrow.import_kwh).toBeCloseTo(12, 2);
    expect(result.tomorrow.export_kwh).toBe(0);
    expect(result.tomorrow.total_cost_pence).toBeCloseTo(240, 1);
  });

  it('emits negative (revenue) cost when PV covers consumption and exports the surplus', () => {
    const rates = slotsForDay('2026-04-11', 20);
    const exportRates = rates.map((r) => ({ ...r, price_inc_vat: 10 }));
    const pv = rates.map((r) => ({ valid_from: r.valid_from, valid_to: r.valid_to, pv_estimate_w: 1500 }));

    getStoredImportRatesMock.mockReturnValue(rates);
    getStoredExportRatesMock.mockReturnValue(exportRates);
    getStoredPVForecastMock.mockReturnValue(pv);

    const result = getEstimatedBill();
    // 1000W export × 0.5h × 48 / 1000 = 24 kWh exported × 10p = 240p revenue.
    expect(result.tomorrow.export_kwh).toBeCloseTo(24, 2);
    expect(result.tomorrow.total_cost_pence).toBeCloseTo(-240, 1);
    expect(result.tomorrow.import_kwh).toBe(0);
  });

  it("flags confidence as 'low' when >25% of slots are missing rate data", () => {
    // Provide rates for only the first 12 slots of tomorrow, leaving 36 uncovered.
    const full = slotsForDay('2026-04-11', 20);
    getStoredImportRatesMock.mockReturnValue(full.slice(0, 12));

    const result = getEstimatedBill();
    expect(result.tomorrow.confidence).toBe('low');
  });

  it("reports confidence 'high' when PV forecast and a usage profile are both available", () => {
    const rates = slotsForDay('2026-04-11', 20);
    const pv = rates.map((r) => ({ valid_from: r.valid_from, valid_to: r.valid_to, pv_estimate_w: 800 }));
    getStoredImportRatesMock.mockReturnValue(rates);
    getStoredPVForecastMock.mockReturnValue(pv);
    // Signal 'profile in use' by returning a value different from the fallback.
    getForecastedConsumptionWMock.mockImplementation((_ts: Date, _fb: number) => 420);

    const result = getEstimatedBill();
    expect(result.tomorrow.confidence).toBe('high');
  });
});

describe('getEstimatedBill — actuals + forecast composition', () => {
  it("adds today's actual cost to the remaining-slot forecast", () => {
    const rates = slotsForDay('2026-04-10', 10);
    getStoredImportRatesMock.mockReturnValue(rates);
    getDailyPnLMock.mockReturnValue({
      daily: [
        {
          date: '2026-04-10',
          net_cost: 85,
          import_kwh: 5,
          export_kwh: 0,
        },
      ],
    });

    const result = getEstimatedBill();
    // Today's total ≥ the actual portion alone (forecast is added on top).
    expect(result.today.actual_cost_pence).toBe(85);
    expect(result.today.total_cost_pence).toBeGreaterThanOrEqual(85);
    expect(result.today.import_kwh).toBeGreaterThanOrEqual(5);
  });

  it('swallows DB errors when looking up the last reading and still returns a forecast', () => {
    // Make the second prepare() call (the MAX(timestamp) lookup) throw.
    prepareMock.mockImplementationOnce(() => ({ all: allMock, get: getMock }));
    prepareMock.mockImplementationOnce(() => {
      throw new Error('DB not initialised');
    });
    const rates = slotsForDay('2026-04-11', 20);
    getStoredImportRatesMock.mockReturnValue(rates);

    expect(() => getEstimatedBill()).not.toThrow();
    const result = getEstimatedBill();
    expect(result.tomorrow).toBeDefined();
  });
});
