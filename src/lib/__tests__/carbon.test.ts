import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAndStoreCarbonIntensity,
  fetchCarbonIntensity,
  getStoredCarbonIntensity,
  isCacheStale,
  storeCarbonIntensity,
} from '../carbon';

const { prepareMock, runMock, allMock, getMock, transactionMock } = vi.hoisted(() => {
  const runMock = vi.fn();
  const allMock = vi.fn();
  const getMock = vi.fn();
  return {
    prepareMock: vi.fn((query: string) => ({ run: runMock, all: allMock, get: getMock })),
    runMock,
    allMock,
    getMock,
    transactionMock: vi.fn((callback: (items: unknown[]) => void) => (items: unknown[]) => callback(items)),
  };
});

vi.mock('../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

describe('carbon helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and maps carbon intensity data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          from: '2026-04-03T10:00Z',
          to: '2026-04-03T10:30Z',
          intensity: { forecast: 100, actual: 90, index: 'moderate' },
        },
      ],
    }), { status: 200 }));

    await expect(fetchCarbonIntensity('from', 'to')).resolves.toEqual([
      {
        period_from: '2026-04-03T10:00Z',
        period_to: '2026-04-03T10:30Z',
        intensity_forecast: 100,
        intensity_actual: 90,
        intensity_index: 'moderate',
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith('https://api.carbonintensity.org.uk/intensity/from/to');
  });

  it('throws a descriptive error when the API call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));

    await expect(fetchCarbonIntensity('from', 'to')).rejects.toThrow(
      'Carbon Intensity API error: 500 Server Error',
    );
  });

  it('stores carbon readings in a transaction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));

    storeCarbonIntensity([
      {
        period_from: 'a',
        period_to: 'b',
        intensity_forecast: 100,
        intensity_actual: 90,
        intensity_index: 'moderate',
      },
    ]);

    expect(runMock).toHaveBeenCalledWith('a', 'b', 100, 90, 'moderate', '2026-04-03T10:15:00.000Z');
    vi.useRealTimers();
  });

  it('fetches then stores carbon readings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ from: 'a', to: 'b', intensity: { forecast: 100, actual: 90, index: 'moderate' } }],
    }), { status: 200 }));

    const result = await fetchAndStoreCarbonIntensity('from', 'to');

    expect(result).toHaveLength(1);
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('queries stored readings with optional filters', () => {
    let capturedQuery = '';
    let capturedParams: string[] = [];
    prepareMock.mockImplementationOnce((query: string) => ({
      run: runMock,
      get: getMock,
      all: (...params: string[]) => {
        capturedQuery = query;
        capturedParams = params;
        return [{ period_from: 'a' }];
      },
    }));

    expect(getStoredCarbonIntensity('from', 'to')).toEqual([{ period_from: 'a' }]);
    expect(capturedQuery).toContain('WHERE period_from >= ? AND period_to <= ?');
    expect(capturedParams).toEqual(['from', 'to']);
  });

  it('marks the cache stale when no matching rows exist', () => {
    getMock.mockReturnValue(undefined);

    expect(isCacheStale('from', 'to')).toBe(true);
  });

  it('marks the cache stale when the data is older than the max age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:30:00Z'));
    getMock.mockReturnValue({ latest: '2026-04-03T09:00:00.000Z' });

    expect(isCacheStale('from', 'to', 30)).toBe(true);
    vi.useRealTimers();
  });

  it('treats recent cached rows as fresh', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:30:00Z'));
    getMock.mockReturnValue({ latest: '2026-04-03T10:20:00.000Z' });

    expect(isCacheStale('from', 'to', 30)).toBe(false);
    vi.useRealTimers();
  });
});
