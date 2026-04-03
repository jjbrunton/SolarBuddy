import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSettingsMock,
  getStoredRatesMock,
  getStoredExportRatesMock,
  getStoredPVForecastMock,
  getStateMock,
  runFullSimulationMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getStoredRatesMock: vi.fn(),
  getStoredExportRatesMock: vi.fn(),
  getStoredPVForecastMock: vi.fn(),
  getStateMock: vi.fn(),
  runFullSimulationMock: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('@/lib/octopus/rates', () => ({
  getStoredRates: getStoredRatesMock,
}));

vi.mock('@/lib/octopus/export-rates', () => ({
  getStoredExportRates: getStoredExportRatesMock,
}));

vi.mock('@/lib/solcast/store', () => ({
  getStoredPVForecast: getStoredPVForecastMock,
}));

vi.mock('@/lib/state', () => ({
  getState: getStateMock,
}));

vi.mock('@/lib/simulator', () => ({
  runFullSimulation: runFullSimulationMock,
}));

import { POST } from './route';

describe('/api/simulate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    getSettingsMock.mockReturnValue({
      pv_forecast_enabled: 'true',
      charge_rate: '100',
    });
    getStateMock.mockReturnValue({ battery_soc: 55 });
  });

  it('returns a 400 when no rates are available', async () => {
    getStoredRatesMock.mockReturnValue([]);

    const response = await POST(
      new Request('http://localhost/api/simulate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'No rates available. Fetch rates first.',
    });
  });

  it('uses current state SOC, merges settings overrides, and passes optional export/PV data', async () => {
    getStoredRatesMock.mockReturnValue([{ valid_from: 'a' }]);
    getStoredExportRatesMock.mockReturnValue([{ valid_from: 'b' }]);
    getStoredPVForecastMock.mockReturnValue([{ valid_from: 'c' }]);
    runFullSimulationMock.mockReturnValue({
      plan: { _dischargeDebug: { foo: 'bar' } },
      slots: [{ slot_start: 'a' }],
      summary: { net_cost: 10 },
    });

    const response = await POST(
      new Request('http://localhost/api/simulate', {
        method: 'POST',
        body: JSON.stringify({
          settings_overrides: { charge_rate: '80' },
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(runFullSimulationMock).toHaveBeenCalledWith({
      rates: [{ valid_from: 'a' }],
      settings: { pv_forecast_enabled: 'true', charge_rate: '80' },
      startSoc: 55,
      exportRates: [{ valid_from: 'b' }],
      pvForecast: [{ valid_from: 'c' }],
      now: new Date('2026-04-03T10:15:00.000Z'),
    });
    expect(await response.json()).toEqual({
      ok: true,
      startSoc: 55,
      plan: { _dischargeDebug: { foo: 'bar' } },
      slots: [{ slot_start: 'a' }],
      summary: { net_cost: 10 },
      _dischargeDebug: { foo: 'bar' },
    });
  });

  it('uses an explicit start SOC and omits empty export/PV data', async () => {
    getSettingsMock.mockReturnValue({ pv_forecast_enabled: 'false' });
    getStoredRatesMock.mockReturnValue([{ valid_from: 'a' }]);
    getStoredExportRatesMock.mockReturnValue([]);
    runFullSimulationMock.mockReturnValue({
      plan: {},
      slots: [],
      summary: {},
    });

    await POST(
      new Request('http://localhost/api/simulate', {
        method: 'POST',
        body: JSON.stringify({ start_soc: 42 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(runFullSimulationMock).toHaveBeenCalledWith({
      rates: [{ valid_from: 'a' }],
      settings: { pv_forecast_enabled: 'false' },
      startSoc: 42,
      exportRates: undefined,
      pvForecast: undefined,
      now: new Date('2026-04-03T10:15:00.000Z'),
    });
  });
});
