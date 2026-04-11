import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB so the client's cache-read path starts empty and we can
// capture writes to pv_forecasts without touching real SQLite.
const { prepareMock, runMock, allMock, getMock, transactionMock, cacheState } = vi.hoisted(() => {
  const cacheState: {
    latest: string | null;
    rows: Array<{
      valid_from: string;
      valid_to: string;
      pv_estimate_w: number;
      pv_estimate10_w: number | null;
      pv_estimate90_w: number | null;
      fetched_at: string;
    }>;
  } = { latest: null, rows: [] };
  const runMock = vi.fn();
  const allMock = vi.fn(() => cacheState.rows);
  const getMock = vi.fn(() => ({ latest: cacheState.latest }));
  const transactionMock = vi.fn((callback: (items: unknown[]) => void) => (items: unknown[]) => callback(items));
  return {
    prepareMock: vi.fn((_query: string) => ({
      run: runMock,
      all: allMock,
      get: getMock,
    })),
    runMock,
    allMock,
    getMock,
    transactionMock,
    cacheState,
  };
});

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

import { fetchPVForecast } from '../client';

describe('fetchPVForecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheState.latest = null;
    cacheState.rows = [];
    vi.restoreAllMocks();
  });

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

  it('uses cached forecast data on the second call within the freshness window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      result: {
        watts: {
          '2026-04-03T10:00:00Z': 0,
          '2026-04-03T11:00:00Z': 1000,
        },
      },
    }), { status: 200 }));

    // First call: cache is empty → hits the API.
    const first = await fetchPVForecast('51.5', '-0.1', '35', '0', '4.2');
    expect(first.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Capture every slot the client just wrote to the cache (upserts have 6
    // args; the opportunistic DELETE at the end passes only 1).
    const writeCalls = runMock.mock.calls
      .filter((args) => args.length === 6)
      .map((args) => ({
        valid_from: args[0] as string,
        valid_to: args[1] as string,
        pv_estimate_w: args[2] as number,
        pv_estimate10_w: args[3] as number | null,
        pv_estimate90_w: args[4] as number | null,
        fetched_at: args[5] as string,
      }));
    expect(writeCalls.length).toBeGreaterThan(0);
    cacheState.rows = writeCalls;
    cacheState.latest = writeCalls[0].fetched_at;

    // Second call: cache is fresh → must return cached rows without a new fetch.
    const second = await fetchPVForecast('51.5', '-0.1', '35', '0', '4.2');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('bypasses the internal cache when force=true', async () => {
    // Seed a "fresh" cache so a non-forced call would short-circuit.
    cacheState.latest = new Date().toISOString();
    cacheState.rows = [
      {
        valid_from: '2026-04-03T10:00:00.000Z',
        valid_to: '2026-04-03T10:30:00.000Z',
        pv_estimate_w: 9999, // stale / wrong value that must NOT be returned
        pv_estimate10_w: 8000,
        pv_estimate90_w: 11000,
        fetched_at: cacheState.latest,
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            watts: {
              '2026-04-03T10:00:00Z': 0,
              '2026-04-03T11:00:00Z': 1000,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const forced = await fetchPVForecast('51.5', '-0.1', '35', '0', '4.2', true);

    // The API must have been hit even though the cache was fresh, and the
    // returned rows must be the fresh interpolated values, not the seeded
    // stale ones.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(forced.every((slot) => slot.pv_estimate_w !== 9999)).toBe(true);
  });
});
