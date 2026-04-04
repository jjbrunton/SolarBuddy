import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';
import {
  fetchAndStoreRates,
  fetchRates,
  getStoredRates,
  resolveRates,
  storeRates,
} from '../rates';

const {
  getSettingsMock,
  generateSyntheticRatesMock,
  getTariffDefinitionMock,
  runMock,
  allMock,
  prepareMock,
  transactionMock,
} = vi.hoisted(() => {
  const runMock = vi.fn();
  const allMock = vi.fn();
  return {
    getSettingsMock: vi.fn(),
    generateSyntheticRatesMock: vi.fn(),
    getTariffDefinitionMock: vi.fn(),
    runMock,
    allMock,
    prepareMock: vi.fn((query: string) => ({
      run: runMock,
      all: allMock,
    })),
    transactionMock: vi.fn((callback: (rates: unknown[]) => void) => (rates: unknown[]) => callback(rates)),
  };
});

vi.mock('../../config', async () => {
  const actual = await vi.importActual<typeof import('../../config')>('../../config');
  return {
    ...actual,
    getSettings: getSettingsMock,
  };
});

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

vi.mock('../../tariffs/rate-generator', () => ({
  generateSyntheticRates: generateSyntheticRatesMock,
}));

vi.mock('../../tariffs/definitions', async () => {
  const actual = await vi.importActual<typeof import('../../tariffs/definitions')>('../../tariffs/definitions');
  return {
    ...actual,
    getTariffDefinition: getTariffDefinitionMock,
  };
});

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    octopus_region: 'H',
    ...overrides,
  };
}

describe('octopus rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(makeSettings());
  });

  it('requires an Octopus region for API rate fetches', async () => {
    getSettingsMock.mockReturnValue(makeSettings({ octopus_region: '' }));

    await expect(fetchRates()).rejects.toThrow('Octopus region not configured');
  });

  it('fetches and maps Agile rates from Octopus', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          valid_from: '2026-04-03T00:00:00Z',
          valid_to: '2026-04-03T00:30:00Z',
          value_inc_vat: 10.5,
          value_exc_vat: 10,
        },
      ],
    }), { status: 200 }));

    await expect(fetchRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z')).resolves.toEqual([
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 10.5,
        price_exc_vat: 10,
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.octopus.energy/v1/products/AGILE-24-10-01/electricity-tariffs/E-1R-AGILE-24-10-01-H/standard-unit-rates/?period_from=2026-04-03T00%3A00%3A00Z&period_to=2026-04-03T01%3A00%3A00Z&page_size=200&order_by=period',
    );
  });

  it('throws a descriptive error when the rates API call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));

    await expect(fetchRates()).rejects.toThrow('Octopus API error: 500 Server Error');
  });

  it('stores each fetched rate in a transaction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T09:15:27Z'));

    storeRates([
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 10.5,
        price_exc_vat: 10,
      },
    ]);

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(runMock).toHaveBeenCalledWith(
      '2026-04-03T00:00:00Z',
      '2026-04-03T00:30:00Z',
      10.5,
      10,
      '2026-04-03T09:15:27.000Z',
    );
    vi.useRealTimers();
  });

  it('fetches and stores rates together', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          valid_from: '2026-04-03T00:00:00Z',
          valid_to: '2026-04-03T00:30:00Z',
          value_inc_vat: 10.5,
          value_exc_vat: 10,
        },
      ],
    }), { status: 200 }));

    const result = await fetchAndStoreRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(runMock).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
  });

  it('uses API rates for Agile tariffs and synthetic rates for fixed tariffs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          valid_from: '2026-04-03T00:00:00Z',
          valid_to: '2026-04-03T00:30:00Z',
          value_inc_vat: 10.5,
          value_exc_vat: 10,
        },
      ],
    }), { status: 200 }));
    getTariffDefinitionMock
      .mockReturnValueOnce({ usesApiRates: true, type: 'agile' })
      .mockReturnValueOnce({ usesApiRates: false, type: 'go' });
    generateSyntheticRatesMock.mockReturnValue([
      {
        valid_from: '2026-04-03T00:00:00.000Z',
        valid_to: '2026-04-03T00:30:00.000Z',
        price_inc_vat: 7.5,
        price_exc_vat: 7.14,
      },
    ]);
    getSettingsMock
      .mockReturnValueOnce(makeSettings({ tariff_type: 'agile' }))
      .mockReturnValueOnce(makeSettings({ tariff_type: 'agile' }))
      .mockReturnValueOnce(makeSettings({ tariff_type: 'go' }));

    const agile = await resolveRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');
    const go = await resolveRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z');

    expect(agile[0].price_inc_vat).toBe(10.5);
    expect(generateSyntheticRatesMock).toHaveBeenCalledWith(
      { usesApiRates: false, type: 'go' },
      expect.objectContaining({ tariff_type: 'go' }),
      '2026-04-03T00:00:00Z',
      '2026-04-03T01:00:00Z',
    );
    expect(go[0].price_inc_vat).toBe(7.5);
  });

  it('queries stored rates with optional boundaries', () => {
    const rows = [
      {
        valid_from: '2026-04-03T00:00:00Z',
        valid_to: '2026-04-03T00:30:00Z',
        price_inc_vat: 10.5,
        price_exc_vat: 10,
      },
    ];
    let capturedQuery = '';
    let capturedParams: string[] = [];

    prepareMock.mockImplementationOnce((query: string) => ({
      run: runMock,
      all: vi.fn((...params: string[]) => {
        capturedQuery = query;
        capturedParams = params;
        return rows;
      }),
    }));

    expect(getStoredRates('2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z')).toEqual(rows);
    expect(capturedQuery).toContain('WHERE valid_from >= ? AND valid_to <= ?');
    expect(capturedParams).toEqual(['2026-04-03T00:00:00Z', '2026-04-03T01:00:00Z']);
  });
});
