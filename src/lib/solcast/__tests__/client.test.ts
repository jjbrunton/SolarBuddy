import { describe, expect, it, vi } from 'vitest';
import { fetchPVForecast } from '../client';

describe('fetchPVForecast', () => {
  it('throws a descriptive error when the API call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));

    await expect(fetchPVForecast('1', '2', '3', '4', '5')).rejects.toThrow(
      'Forecast.Solar API error: 500 Server Error',
    );
  });

  it('returns an empty list when the response has no watts payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: {} }), { status: 200 }));

    await expect(fetchPVForecast('1', '2', '3', '4', '5')).resolves.toEqual([]);
  });

  it('interpolates hourly watts into half-hour slots', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      result: {
        watts: {
          '2026-04-03T10:00:00Z': 0,
          '2026-04-03T11:00:00Z': 1000,
          '2026-04-03T12:00:00Z': 2000,
        },
      },
    }), { status: 200 }));

    await expect(fetchPVForecast('51.5', '-0.1', '35', '0', '4.2')).resolves.toEqual([
      {
        valid_from: '2026-04-03T10:00:00.000Z',
        valid_to: '2026-04-03T10:30:00.000Z',
        pv_estimate_w: 250,
        pv_estimate10_w: 200,
        pv_estimate90_w: 300,
      },
      {
        valid_from: '2026-04-03T10:30:00.000Z',
        valid_to: '2026-04-03T11:00:00.000Z',
        pv_estimate_w: 750,
        pv_estimate10_w: 600,
        pv_estimate90_w: 900,
      },
      {
        valid_from: '2026-04-03T11:00:00.000Z',
        valid_to: '2026-04-03T11:30:00.000Z',
        pv_estimate_w: 1250,
        pv_estimate10_w: 1000,
        pv_estimate90_w: 1500,
      },
      {
        valid_from: '2026-04-03T11:30:00.000Z',
        valid_to: '2026-04-03T12:00:00.000Z',
        pv_estimate_w: 1750,
        pv_estimate10_w: 1400,
        pv_estimate90_w: 2100,
      },
    ]);
  });
});
