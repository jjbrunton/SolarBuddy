import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../config';
import {
  fetchExportRates,
  getStoredExportRates,
  resolveExportRates,
  storeExportRates,
} from '../export-rates';

const {
  getSettingsMock,
  generateSyntheticExportRatesMock,
  runMock,
  allMock,
  prepareMock,
  transactionMock,
} = vi.hoisted(() => {
  const runMock = vi.fn();
  const allMock = vi.fn();
  return {
    getSettingsMock: vi.fn(),
    generateSyntheticExportRatesMock: vi.fn(),
    runMock,
    allMock,
    prepareMock: vi.fn((query: string) => ({
      run: runMock,
      all: allMock,
    })),
    transactionMock: vi.fn((callback: (rates: unknown[]) => void) => (rates: unknown[]) => callback(rates)),
  };
});

vi.mock('../../config', async () => {
  const actual = await vi.importActual<typeof import('../../config')>('../../config');
  return {
    ...actual,
    getSettings: getSettingsMock,
  };
});

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

vi.mock('../../tariffs/rate-generator', () => ({
  generateSyntheticExportRates: generateSyntheticExportRatesMock,
}));

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    mqtt_host: '',
    mqtt_port: '1883',
    mqtt_username: '',
    mqtt_password: '',
    octopus_region: 'H',
    octopus_product_code: 'AGILE-24-10-01',
    octopus_api_key: '',
    octopus_account: '',
    octopus_mpan: '',
    octopus_meter_serial: '',
    charging_strategy: 'night_fill',
    charge_hours: '4',
    price_threshold: '0',
    min_soc_target: '80',
    charge_window_start: '23:00',
    charge_window_end: '07:00',
    default_work_mode: 'Battery first',
    charge_rate: '100',
    auto_schedule: 'true',
    watchdog_enabled: 'true',
    battery_capacity_kwh: '5.12',
    max_charge_power_kw: '3.6',
    estimated_consumption_w: '500',
    tariff_type: 'agile',
    tariff_offpeak_rate: '7.5',
    tariff_peak_rate: '35',
    tariff_standard_rate: '24.5',
    negative_price_charging: 'true',
    negative_price_pre_discharge: 'false',
    smart_discharge: 'false',
    discharge_price_threshold: '0',
    discharge_soc_floor: '20',
    peak_protection: 'false',
    peak_period_start: '16:00',
    peak_period_end: '19:00',
    peak_soc_target: '90',
    octopus_export_mpan: '200000000001',
    octopus_export_meter_serial: 'E123',
    octopus_export_product_code: 'OUTGOING-25-01-01',
    export_rate: '8.5',
    pv_forecast_enabled: 'false',
    pv_forecast_confidence: 'estimate',
    pv_latitude: '',
    pv_longitude: '',
    pv_declination: '35',
    pv_azimuth: '0',
    pv_kwp: '',
    time_sync_enabled: 'false',
    tariff_monitor_enabled: 'true',
    ...overrides,
  };
}

describe('octopus export rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(makeSettings());
  });

  it('returns no API rates when export configuration is incomplete', async () => {
    getSettingsMock.mockReturnValue(makeSettings({
      octopus_export_mpan: '',
      octopus_export_product_code: '',
      octopus_region: '',
    }));

    await expect(fetchExportRates()).resolves.toEqual([]);
  });

  it('fetches export rates from the configured Octopus tariff and maps the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          valid_from: '2026-04-03T00:00:00Z',
          valid_to: '2026-04-03T00:30:00Z',
          value_inc_vat: 18.75,
          value_exc_vat: 17.8571,
        },
      ],
    }), { status: 200 }));

    const rates = await fetchExportRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.octopus.energy/v1/products/OUTGOING-25-01-01/electricity-tariffs/E-1R-OUTGOING-25-01-01-H/standard-unit-rates/?period_from=2026-04-03T00%3A00%3A00Z&period_to=2026-04-03T01%3A00%3A00Z&page_size=200&order_by=period',
    );
    expect(rates).toEqual([
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 18.75,
        price_exc_vat: 17.8571,
      },
    ]);
  });

  it('throws a descriptive error when the Octopus API request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));

    await expect(fetchExportRates()).rejects.toThrow('Octopus API error (export): 500 Server Error');
  });

  it('stores each export rate inside a transaction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T09:15:27Z'));

    storeExportRates([
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 18.75,
        price_exc_vat: 17.8571,
      },
      {
        valid_from: '2026-04-03T00:30:00Z',
        valid_to: '2026-04-03T01:00:00Z',
        price_inc_vat: 17.4,
        price_exc_vat: 16.5714,
      },
    ]);

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(runMock).toHaveBeenNthCalledWith(
      1,
      '2026-04-03T00:00:00Z',
      '2026-04-03T00:30:00Z',
      18.75,
      17.8571,
      '2026-04-03T09:15:27.000Z',
    );
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      '2026-04-03T00:30:00Z',
      '2026-04-03T01:00:00Z',
      17.4,
      16.5714,
      '2026-04-03T09:15:27.000Z',
    );

    vi.useRealTimers();
  });

  it('queries stored export rates with optional from/to filters', () => {
    const rows = [
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 18.75,
        price_exc_vat: 17.8571,
      },
    ];
    let capturedQuery = '';
    let capturedParams: string[] = [];

    prepareMock.mockImplementationOnce((query: string) => ({
      run: runMock,
      all: (...params: string[]) => {
        capturedQuery = query;
        capturedParams = params;
        return rows;
      },
    }));

    const result = getStoredExportRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(capturedQuery).toContain('WHERE valid_from >= ? AND valid_to <= ?');
    expect(capturedQuery).toContain('ORDER BY valid_from ASC');
    expect(capturedParams).toEqual(['2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z']);
    expect(result).toEqual(rows);
  });

  it('uses live export rates when the export tariff returns data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          valid_from: '2026-04-03T00:00:00Z',
          valid_to: '2026-04-03T00:30:00Z',
          value_inc_vat: 18.75,
          value_exc_vat: 17.8571,
        },
      ],
    }), { status: 200 }));

    const result = await resolveExportRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(generateSyntheticExportRatesMock).not.toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 18.75,
        price_exc_vat: 17.8571,
      },
    ]);
  });

  it('falls back to synthetic export slots when the API returns no data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    generateSyntheticExportRatesMock.mockReturnValue([
      {
        valid_from: '2026-04-03T00:00:00.000Z',
        valid_to: '2026-04-03T00:30:00.000Z',
        price_inc_vat: 8.5,
        price_exc_vat: 8.095238,
      },
    ]);

    const result = await resolveExportRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(generateSyntheticExportRatesMock).toHaveBeenCalledWith(
      8.5,
      '2026-04-03T00:00:00Z',
      '2026-04-03T01:00:00Z',
    );
    expect(result).toEqual([
      {
        valid_from: '2026-04-03T00:00:00.000Z',
        valid_to: '2026-04-03T00:30:00.000Z',
        price_inc_vat: 8.5,
        price_exc_vat: 8.095238,
      },
    ]);
  });

  it('uses synthetic export slots directly when no export tariff is configured', async () => {
    getSettingsMock.mockReturnValue(makeSettings({
      octopus_export_mpan: '',
      octopus_export_product_code: '',
      export_rate: '5.25',
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    generateSyntheticExportRatesMock.mockReturnValue([
      {
        valid_from: '2026-04-03T00:00:00.000Z',
        valid_to: '2026-04-03T00:30:00.000Z',
        price_inc_vat: 5.25,
        price_exc_vat: 5,
      },
    ]);

    const result = await resolveExportRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generateSyntheticExportRatesMock).toHaveBeenCalledWith(
      5.25,
      '2026-04-03T00:00:00Z',
      '2026-04-03T01:00:00Z',
    );
    expect(result[0].price_inc_vat).toBe(5.25);
  });
});
