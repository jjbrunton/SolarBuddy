import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBatteryData,
  getCarbonData,
  getEnergyData,
  getRatesCompareData,
  getSavingsData,
} from '../analytics-data';

const {
  prepareMock,
  allMock,
  periodToISOMock,
  wattSamplesToKwhMock,
  fetchAndStoreCarbonIntensityMock,
  getStoredCarbonIntensityMock,
  isCacheStaleMock,
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  periodToISOMock: vi.fn(),
  wattSamplesToKwhMock: vi.fn(),
  fetchAndStoreCarbonIntensityMock: vi.fn(),
  getStoredCarbonIntensityMock: vi.fn(),
  isCacheStaleMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

vi.mock('../analytics', async () => {
  const actual = await vi.importActual<typeof import('../analytics')>('../analytics');
  return {
    ...actual,
    periodToISO: periodToISOMock,
    wattSamplesToKwh: wattSamplesToKwhMock,
  };
});

vi.mock('../carbon', () => ({
  fetchAndStoreCarbonIntensity: fetchAndStoreCarbonIntensityMock,
  getStoredCarbonIntensity: getStoredCarbonIntensityMock,
  isCacheStale: isCacheStaleMock,
}));

describe('analytics data helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({ all: allMock });
    periodToISOMock.mockReturnValue('2026-04-01T00:00:00Z');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates savings totals from weighted rates', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-01',
        import_w_sum: 1000,
        sample_count: 4,
        weighted_cost_sum: 12000,
        max_rate: 40,
      },
    ]);
    wattSamplesToKwhMock.mockReturnValue(6);

    expect(getSavingsData('7d')).toEqual({
      summary: {
        total_import_kwh: 6,
        actual_cost: 72,
        flat_rate_cost: 147,
        peak_rate_cost: 240,
        savings_vs_flat: 75,
        savings_vs_peak: 168,
      },
      daily: [
        {
          date: '2026-04-01',
          import_kwh: 6,
          actual_cost: 72,
          flat_rate_cost: 147,
          peak_rate_cost: 240,
          savings: 75,
        },
      ],
    });
  });

  it('derives battery depth-of-discharge summaries', () => {
    allMock.mockReturnValue([
      { date: '2026-04-01', min_soc: 20, max_soc: 80 },
      { date: '2026-04-02', min_soc: 10, max_soc: 70 },
    ]);

    expect(getBatteryData('30d')).toEqual({
      summary: {
        total_equivalent_cycles: 1.2,
        avg_daily_cycles: 0.6,
        avg_depth_of_discharge: 60,
        max_depth_of_discharge: 60,
        avg_min_soc: 15,
      },
      daily: [
        {
          date: '2026-04-01',
          min_soc: 20,
          max_soc: 80,
          depth_of_discharge: 60,
          equivalent_cycles: 0.6,
          cumulative_cycles: 0.6,
        },
        {
          date: '2026-04-02',
          min_soc: 10,
          max_soc: 70,
          depth_of_discharge: 60,
          equivalent_cycles: 0.6,
          cumulative_cycles: 1.2,
        },
      ],
    });
  });

  it('fetches stale carbon data and combines it with solar generation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    isCacheStaleMock.mockReturnValue(true);
    getStoredCarbonIntensityMock.mockReturnValue([
      {
        period_from: '2026-04-03T10:00:00.000Z',
        period_to: '2026-04-03T10:30:00.000Z',
        intensity_forecast: 100,
        intensity_actual: 95,
        intensity_index: 'moderate',
      },
      {
        period_from: '2026-04-03T10:30:00.000Z',
        period_to: '2026-04-03T11:00:00.000Z',
        intensity_forecast: 200,
        intensity_actual: 190,
        intensity_index: 'high',
      },
    ]);
    allMock.mockReturnValue([
      { half_hour: '2026-04-03T10:00:00.000Z', pv_sum: 2000, sample_count: 2 },
      { half_hour: '2026-04-03T10:30:00.000Z', pv_sum: 1000, sample_count: 2 },
    ]);
    wattSamplesToKwhMock.mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);

    const result = await getCarbonData('today');

    expect(fetchAndStoreCarbonIntensityMock).toHaveBeenCalledWith(
      '2026-04-01T00:00:00Z',
      '2026-04-03T10:15:00.000Z',
    );
    expect(result).toEqual({
      summary: {
        current_intensity: 100,
        current_index: 'moderate',
        avg_intensity: 150,
        carbon_saved_g: 100,
        carbon_saved_kg: 0.1,
      },
      halfhourly: [
        {
          from: '2026-04-03T10:00:00.000Z',
          to: '2026-04-03T10:30:00.000Z',
          forecast: 100,
          actual: 95,
          index: 'moderate',
          solar_kwh: 0.5,
          carbon_saved_g: 50,
        },
        {
          from: '2026-04-03T10:30:00.000Z',
          to: '2026-04-03T11:00:00.000Z',
          forecast: 200,
          actual: 190,
          index: 'high',
          solar_kwh: 0.25,
          carbon_saved_g: 50,
        },
      ],
    });
  });

  it('swallows carbon refresh failures and still returns stored data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    isCacheStaleMock.mockReturnValue(true);
    fetchAndStoreCarbonIntensityMock.mockRejectedValue(new Error('offline'));
    getStoredCarbonIntensityMock.mockReturnValue([]);
    allMock.mockReturnValue([]);

    expect(await getCarbonData('today')).toEqual({
      summary: {
        current_intensity: null,
        current_index: null,
        avg_intensity: null,
        carbon_saved_g: 0,
        carbon_saved_kg: 0,
      },
      halfhourly: [],
    });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('derives energy flow totals and self-sufficiency', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-01',
        import_w_sum: 100,
        export_w_sum: 20,
        generation_w_sum: 300,
        consumption_w_sum: 400,
        sample_count: 4,
      },
      {
        date: '2026-04-02',
        import_w_sum: 0,
        export_w_sum: 0,
        generation_w_sum: 100,
        consumption_w_sum: 0,
        sample_count: 4,
      },
    ]);
    wattSamplesToKwhMock
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0);

    expect(getEnergyData('30d')).toEqual({
      summary: {
        total_import_kwh: 1,
        total_export_kwh: 0.2,
        total_generation_kwh: 4,
        total_consumption_kwh: 4,
        avg_self_sufficiency: 87.5,
      },
      daily: [
        {
          date: '2026-04-01',
          import_kwh: 1,
          export_kwh: 0.2,
          generation_kwh: 3,
          consumption_kwh: 4,
          self_sufficiency: 75,
        },
        {
          date: '2026-04-02',
          import_kwh: 0,
          export_kwh: 0,
          generation_kwh: 1,
          consumption_kwh: 0,
          self_sufficiency: 100,
        },
      ],
    });
  });

  it('summarises today versus historical rate comparisons', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    allMock
      .mockReturnValueOnce([
        { date: '2026-04-01', avg_price: 20, min_price: 5, max_price: 40, negative_slots: 1 },
        { date: '2026-04-03', avg_price: 30, min_price: 10, max_price: 60, negative_slots: 0 },
      ])
      .mockReturnValueOnce([
        { time_slot: '00:00', avg_price: 18, min_price: 5, max_price: 25 },
        { time_slot: '00:30', avg_price: 22, min_price: 10, max_price: 30 },
      ])
      .mockReturnValueOnce([
        { time_slot: '00:00', price: 35 },
        { time_slot: '00:30', price: 25 },
      ]);

    expect(getRatesCompareData('7d')).toEqual({
      today: {
        avg_price: 30,
        min_price: 25,
        max_price: 35,
      },
      comparison: {
        avg_price: 20,
        price_change_pct: 50,
      },
      daily_averages: [
        { date: '2026-04-01', avg_price: 20, min_price: 5, max_price: 40, negative_slots: 1 },
        { date: '2026-04-03', avg_price: 30, min_price: 10, max_price: 60, negative_slots: 0 },
      ],
      time_of_day: [
        { time_slot: '00:00', today_price: 35, avg_price: 18, min_price: 5, max_price: 25 },
        { time_slot: '00:30', today_price: 25, avg_price: 22, min_price: 10, max_price: 30 },
      ],
    });
  });
});
