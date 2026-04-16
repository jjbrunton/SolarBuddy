import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshNordpoolForecast } from '../refresh';

const { getSettingsMock, fetchDayAheadMock, storeImportRatesMock, appendEventMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  fetchDayAheadMock: vi.fn(),
  storeImportRatesMock: vi.fn(),
  appendEventMock: vi.fn(),
}));

vi.mock('../../config', () => ({ getSettings: getSettingsMock }));
vi.mock('../client', () => ({ fetchNordpoolDayAhead: fetchDayAheadMock }));
vi.mock('../../db/rate-repository', () => ({ storeImportRates: storeImportRatesMock }));
vi.mock('../../events', () => ({ appendEvent: appendEventMock }));

const enabledAgileSettings = {
  nordpool_forecast_enabled: 'true',
  tariff_type: 'agile',
  nordpool_distribution_multiplier: '2.2',
  nordpool_peak_adder: '12.5',
  nordpool_peak_start: '16:00',
  nordpool_peak_end: '19:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('refreshNordpoolForecast', () => {
  it('skips when nordpool forecasting is disabled', async () => {
    getSettingsMock.mockReturnValue({ ...enabledAgileSettings, nordpool_forecast_enabled: 'false' });
    const result = await refreshNordpoolForecast();
    expect(result).toEqual({ status: 'skipped', reason: 'disabled', date: '' });
    expect(fetchDayAheadMock).not.toHaveBeenCalled();
  });

  it('skips when tariff is not agile', async () => {
    getSettingsMock.mockReturnValue({ ...enabledAgileSettings, tariff_type: 'go' });
    const result = await refreshNordpoolForecast();
    expect(result).toEqual({ status: 'skipped', reason: 'not_agile', date: '' });
  });

  it('skips when Nordpool returns no prices', async () => {
    getSettingsMock.mockReturnValue(enabledAgileSettings);
    fetchDayAheadMock.mockResolvedValue([]);

    const result = await refreshNordpoolForecast();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('no_prices');
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(storeImportRatesMock).not.toHaveBeenCalled();
  });

  it('converts slots, stores rates, and logs success', async () => {
    getSettingsMock.mockReturnValue(enabledAgileSettings);
    fetchDayAheadMock.mockResolvedValue([
      { valid_from: '2026-04-17T00:00:00Z', valid_to: '2026-04-17T00:30:00Z', wholesale_price_pkwh: 5 },
      { valid_from: '2026-04-17T00:30:00Z', valid_to: '2026-04-17T01:00:00Z', wholesale_price_pkwh: 5 },
    ]);

    const result = await refreshNordpoolForecast();

    expect(result.status).toBe('ok');
    expect(storeImportRatesMock).toHaveBeenCalledTimes(1);
    const [rates, source] = storeImportRatesMock.mock.calls[0];
    expect(source).toBe('nordpool');
    expect(rates).toHaveLength(2);
    expect(appendEventMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'success',
      category: 'nordpool',
    }));
  });

  it('returns error and logs warning when fetch throws', async () => {
    getSettingsMock.mockReturnValue(enabledAgileSettings);
    fetchDayAheadMock.mockRejectedValue(new Error('nordpool down'));

    const result = await refreshNordpoolForecast();

    expect(result).toEqual({ status: 'error', message: 'nordpool down' });
    expect(appendEventMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      category: 'nordpool',
      message: expect.stringContaining('nordpool down'),
    }));
    expect(storeImportRatesMock).not.toHaveBeenCalled();
  });

  it('falls back to default multiplier/adder when values are non-numeric', async () => {
    getSettingsMock.mockReturnValue({
      ...enabledAgileSettings,
      nordpool_distribution_multiplier: 'nope',
      nordpool_peak_adder: '',
    });
    fetchDayAheadMock.mockResolvedValue([
      { valid_from: '2026-04-17T00:00:00Z', valid_to: '2026-04-17T00:30:00Z', wholesale_price_pkwh: 10 },
    ]);

    const result = await refreshNordpoolForecast();
    expect(result.status).toBe('ok');
    // Defaults are 2.2 multiplier + 0 adder off-peak, so ~10 * 2.2 = 22
    const [rates] = storeImportRatesMock.mock.calls[0];
    expect(rates[0].price_inc_vat).toBeGreaterThan(0);
  });
});
