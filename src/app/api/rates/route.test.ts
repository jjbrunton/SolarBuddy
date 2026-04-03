import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getStoredRatesMock,
  getStoredExportRatesMock,
  fetchAndStoreRatesMock,
} = vi.hoisted(() => ({
  getStoredRatesMock: vi.fn(),
  getStoredExportRatesMock: vi.fn(),
  fetchAndStoreRatesMock: vi.fn(),
}));

vi.mock('@/lib/octopus/rates', () => ({
  getStoredRates: getStoredRatesMock,
  fetchAndStoreRates: fetchAndStoreRatesMock,
}));

vi.mock('@/lib/octopus/export-rates', () => ({
  getStoredExportRates: getStoredExportRatesMock,
}));

import { GET, POST } from './route';

describe('/api/rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stored import and export rates for the requested range', async () => {
    getStoredRatesMock.mockReturnValue([{ valid_from: 'a' }]);
    getStoredExportRatesMock.mockReturnValue([{ valid_from: 'b' }]);

    const response = await GET(new Request('http://localhost/api/rates?from=1&to=2'));

    expect(getStoredRatesMock).toHaveBeenCalledWith('1', '2');
    expect(getStoredExportRatesMock).toHaveBeenCalledWith('1', '2');
    expect(await response.json()).toEqual({
      rates: [{ valid_from: 'a' }],
      exportRates: [{ valid_from: 'b' }],
    });
  });

  it('fetches and stores the latest rates window', async () => {
    fetchAndStoreRatesMock.mockResolvedValue([{ valid_from: 'slot' }]);
    const now = new Date('2026-04-03T10:15:00Z');
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const response = await POST();

    expect(fetchAndStoreRatesMock).toHaveBeenCalledWith(
      now.toISOString(),
      tomorrow.toISOString(),
    );
    expect(await response.json()).toEqual({
      ok: true,
      count: 1,
      rates: [{ valid_from: 'slot' }],
    });
  });

  it('returns a 500 when the fetch fails', async () => {
    fetchAndStoreRatesMock.mockRejectedValue(new Error('octopus offline'));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'octopus offline',
    });
  });
});
