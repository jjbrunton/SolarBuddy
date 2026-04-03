import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSettingsMock,
  fetchPVForecastMock,
  storePVForecastMock,
  getStoredPVForecastMock,
  getLatestForecastAgeMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  fetchPVForecastMock: vi.fn(),
  storePVForecastMock: vi.fn(),
  getStoredPVForecastMock: vi.fn(),
  getLatestForecastAgeMock: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('@/lib/solcast/client', () => ({
  fetchPVForecast: fetchPVForecastMock,
}));

vi.mock('@/lib/solcast/store', () => ({
  storePVForecast: storePVForecastMock,
  getStoredPVForecast: getStoredPVForecastMock,
  getLatestForecastAge: getLatestForecastAgeMock,
}));

import { GET, POST } from './route';

describe('/api/forecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({
      pv_latitude: '51.5',
      pv_longitude: '-0.1',
      pv_declination: '35',
      pv_azimuth: '0',
      pv_kwp: '4.2',
    });
  });

  it('returns stored forecasts and the rounded data age', async () => {
    getStoredPVForecastMock.mockReturnValue([{ period_end: 'a' }]);
    getLatestForecastAgeMock.mockReturnValue(12.6);

    const response = await GET(new Request('http://localhost/api/forecast?from=1&to=2'));

    expect(getStoredPVForecastMock).toHaveBeenCalledWith('1', '2');
    expect(await response.json()).toEqual({
      forecasts: [{ period_end: 'a' }],
      ageMinutes: 13,
    });
  });

  it('validates the required PV configuration', async () => {
    getSettingsMock.mockReturnValue({
      pv_latitude: '',
      pv_longitude: '',
      pv_declination: '35',
      pv_azimuth: '0',
      pv_kwp: '',
    });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'PV system location (latitude, longitude) and capacity (kWp) must be configured',
    });
  });

  it('skips the API call when forecast data is still fresh', async () => {
    getLatestForecastAgeMock.mockReturnValue(90.2);

    const response = await POST();

    expect(await response.json()).toEqual({
      ok: true,
      message: 'Forecast data is 90 minutes old — still fresh, skipping API call',
      count: 0,
    });
    expect(fetchPVForecastMock).not.toHaveBeenCalled();
  });

  it('fetches and stores forecasts when the cache is stale', async () => {
    getLatestForecastAgeMock.mockReturnValue(121);
    fetchPVForecastMock.mockResolvedValue([{ period_end: 'a' }]);

    const response = await POST();

    expect(fetchPVForecastMock).toHaveBeenCalledWith('51.5', '-0.1', '35', '0', '4.2');
    expect(storePVForecastMock).toHaveBeenCalledWith([{ period_end: 'a' }]);
    expect(await response.json()).toEqual({ ok: true, count: 1 });
  });

  it('returns a 500 when the PV forecast fetch fails', async () => {
    getLatestForecastAgeMock.mockReturnValue(121);
    fetchPVForecastMock.mockRejectedValue(new Error('solcast offline'));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'solcast offline',
    });
  });
});
