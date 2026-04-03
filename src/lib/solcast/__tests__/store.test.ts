import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestForecastAge, getStoredPVForecast, storePVForecast } from '../store';

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

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

describe('pv forecast store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores forecast slots in a transaction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:00:00Z'));

    storePVForecast([
      {
        valid_from: 'a',
        valid_to: 'b',
        pv_estimate_w: 100,
        pv_estimate10_w: 80,
        pv_estimate90_w: 120,
      },
    ]);

    expect(runMock).toHaveBeenCalledWith('a', 'b', 100, 80, 120, '2026-04-03T10:00:00.000Z');
    vi.useRealTimers();
  });

  it('queries stored forecast slots with optional ranges', () => {
    let capturedQuery = '';
    let capturedParams: string[] = [];
    prepareMock.mockImplementationOnce((query: string) => ({
      run: runMock,
      get: getMock,
      all: (...params: string[]) => {
        capturedQuery = query;
        capturedParams = params;
        return [{ valid_from: 'a' }];
      },
    }));

    expect(getStoredPVForecast('from', 'to')).toEqual([{ valid_from: 'a' }]);
    expect(capturedQuery).toContain('WHERE valid_from >= ? AND valid_to <= ?');
    expect(capturedParams).toEqual(['from', 'to']);
  });

  it('returns Infinity when no forecast has been stored', () => {
    getMock.mockReturnValue(undefined);

    expect(getLatestForecastAge()).toBe(Infinity);
  });

  it('returns the age in minutes for the latest forecast', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:30:00Z'));
    getMock.mockReturnValue({ latest: '2026-04-03T10:00:00.000Z' });

    expect(getLatestForecastAge()).toBe(30);
    vi.useRealTimers();
  });
});
