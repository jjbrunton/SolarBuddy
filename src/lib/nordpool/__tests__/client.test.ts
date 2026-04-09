import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNordpoolDayAhead } from '../client';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

function makeApiResponse(hours: { start: string; end: string; price: number }[]) {
  return {
    deliveryDateCET: '2025-01-15',
    market: 'N2EX_DayAhead',
    deliveryAreas: ['UK'],
    multiAreaEntries: hours.map((h) => ({
      deliveryStart: h.start,
      deliveryEnd: h.end,
      entryPerArea: { UK: h.price },
    })),
  };
}

describe('fetchNordpoolDayAhead', () => {
  it('fetches and converts hourly prices to half-hourly slots', async () => {
    const apiData = makeApiResponse([
      {
        start: '2025-01-15T00:00:00Z',
        end: '2025-01-15T01:00:00Z',
        price: 50, // £50/MWh = 5 p/kWh
      },
      {
        start: '2025-01-15T01:00:00Z',
        end: '2025-01-15T02:00:00Z',
        price: 80, // £80/MWh = 8 p/kWh
      },
    ]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => apiData,
    });

    const slots = await fetchNordpoolDayAhead('2025-01-15');

    expect(slots).toHaveLength(4); // 2 hours × 2 half-hours

    // First hour: 00:00-00:30 and 00:30-01:00
    expect(slots[0].wholesale_price_pkwh).toBe(5);
    expect(slots[0].valid_from).toBe('2025-01-15T00:00:00.000Z');
    expect(slots[0].valid_to).toBe('2025-01-15T00:30:00.000Z');

    expect(slots[1].wholesale_price_pkwh).toBe(5);
    expect(slots[1].valid_from).toBe('2025-01-15T00:30:00.000Z');
    expect(slots[1].valid_to).toBe('2025-01-15T01:00:00.000Z');

    // Second hour: 01:00-01:30 and 01:30-02:00
    expect(slots[2].wholesale_price_pkwh).toBe(8);
    expect(slots[3].wholesale_price_pkwh).toBe(8);
  });

  it('builds the correct API URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeApiResponse([]),
    });

    await fetchNordpoolDayAhead('2025-03-20');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?date=2025-03-20&market=N2EX_DayAhead&deliveryArea=UK&currency=GBP'
    );
  });

  it('throws on non-200 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(fetchNordpoolDayAhead('2025-01-15')).rejects.toThrow(
      'Nordpool API error: 503 Service Unavailable'
    );
  });

  it('returns empty array when no entries', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeApiResponse([]),
    });

    const slots = await fetchNordpoolDayAhead('2025-01-15');
    expect(slots).toEqual([]);
  });

  it('skips entries with missing UK price', async () => {
    const apiData = {
      deliveryDateCET: '2025-01-15',
      market: 'N2EX_DayAhead',
      deliveryAreas: ['UK'],
      multiAreaEntries: [
        {
          deliveryStart: '2025-01-15T00:00:00Z',
          deliveryEnd: '2025-01-15T01:00:00Z',
          entryPerArea: { DE: 40 }, // No UK entry
        },
        {
          deliveryStart: '2025-01-15T01:00:00Z',
          deliveryEnd: '2025-01-15T02:00:00Z',
          entryPerArea: { UK: 60 },
        },
      ],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => apiData,
    });

    const slots = await fetchNordpoolDayAhead('2025-01-15');
    expect(slots).toHaveLength(2); // Only the second hour (2 half-hour slots)
    expect(slots[0].wholesale_price_pkwh).toBe(6); // 60/10
  });

  it('converts £/MWh to p/kWh correctly', async () => {
    const apiData = makeApiResponse([
      {
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        price: 123.45, // £123.45/MWh = 12.345 p/kWh
      },
    ]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => apiData,
    });

    const slots = await fetchNordpoolDayAhead('2025-01-15');
    expect(slots[0].wholesale_price_pkwh).toBeCloseTo(12.345);
  });
});
