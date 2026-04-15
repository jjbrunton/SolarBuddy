import { beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshNordpoolForecastMock, replanFromStoredRatesMock } = vi.hoisted(() => ({
  refreshNordpoolForecastMock: vi.fn(),
  replanFromStoredRatesMock: vi.fn(),
}));

vi.mock('@/lib/nordpool/refresh', () => ({
  refreshNordpoolForecast: refreshNordpoolForecastMock,
}));

vi.mock('@/lib/scheduler/cron', () => ({
  replanFromStoredRates: replanFromStoredRatesMock,
}));

import { POST } from './route';

describe('/api/rates/nordpool/refresh POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok and replans when the forecast refresh succeeds', async () => {
    refreshNordpoolForecastMock.mockResolvedValue({
      status: 'ok',
      date: '2026-04-16',
      count: 48,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      date: '2026-04-16',
      count: 48,
    });
    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);
  });

  it('returns skipped without replanning when the refresh is skipped', async () => {
    refreshNordpoolForecastMock.mockResolvedValue({
      status: 'skipped',
      reason: 'disabled',
      date: '',
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'skipped',
      reason: 'disabled',
      date: '',
    });
    expect(replanFromStoredRatesMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the refresh reports an error', async () => {
    refreshNordpoolForecastMock.mockResolvedValue({
      status: 'error',
      message: 'Nordpool API error: 503 Service Unavailable',
    });

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 'error',
      message: 'Nordpool API error: 503 Service Unavailable',
    });
    expect(replanFromStoredRatesMock).not.toHaveBeenCalled();
  });

  it('returns an error response when the refresh throws', async () => {
    refreshNordpoolForecastMock.mockRejectedValue(new Error('db unavailable'));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'db unavailable' });
  });
});
