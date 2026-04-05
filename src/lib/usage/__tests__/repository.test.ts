import { beforeAll, beforeEach, describe, expect, it, vi, afterAll } from 'vitest';

const { metaGetMock, bucketsAllMock, getSettingsMock } = vi.hoisted(() => ({
  metaGetMock: vi.fn(),
  bucketsAllMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('usage_profile_meta')) return { get: metaGetMock };
      if (sql.includes('usage_profile')) return { all: bucketsAllMock };
      return { get: vi.fn(), all: vi.fn() };
    },
  }),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

import {
  getForecastedConsumptionW,
  getAverageForecastedConsumptionW,
  getBaseloadW,
  getUsageHighPeriods,
  getUsageProfile,
  invalidateUsageProfileCache,
} from '../repository';

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Europe/London';
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function baseSettings() {
  return {
    usage_learning_enabled: 'true',
    usage_min_samples_per_bucket: '5',
  } as Partial<Record<string, string>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateUsageProfileCache();
  getSettingsMock.mockReturnValue(baseSettings());
});

describe('repository — no profile loaded', () => {
  it('returns fallback when usage_profile_meta is empty', () => {
    metaGetMock.mockReturnValue(undefined);
    bucketsAllMock.mockReturnValue([]);

    expect(getForecastedConsumptionW(new Date('2026-01-15T17:00:00Z'), 500)).toBe(500);
    expect(getBaseloadW()).toBeNull();
    expect(getUsageProfile()).toBeNull();
    expect(getUsageHighPeriods()).toEqual({ weekday: [], weekend: [] });
  });

  it('returns fallback when learning is disabled, even if a profile exists', () => {
    getSettingsMock.mockReturnValue({ ...baseSettings(), usage_learning_enabled: 'false' });
    metaGetMock.mockReturnValue({
      baseload_w: 320,
      baseload_percentile: 10,
      window_days: 14,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-15T00:00:00Z',
      total_samples: 10000,
      computed_at: '2026-01-15T03:17:00Z',
      high_periods_json: '{"weekday":[],"weekend":[]}',
    });
    bucketsAllMock.mockReturnValue([
      {
        day_type: 'weekday',
        slot_index: 34,
        median_w: 1200,
        p25_w: 1100,
        p75_w: 1300,
        mean_w: 1200,
        sample_count: 50,
        updated_at: '2026-01-15T03:17:00Z',
      },
    ]);

    expect(getForecastedConsumptionW(new Date('2026-01-15T17:00:00Z'), 500)).toBe(500);
  });
});

describe('repository — profile loaded', () => {
  beforeEach(() => {
    metaGetMock.mockReturnValue({
      baseload_w: 320,
      baseload_percentile: 10,
      window_days: 14,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-15T00:00:00Z',
      total_samples: 10000,
      computed_at: '2026-01-15T03:17:00Z',
      high_periods_json: JSON.stringify({
        weekday: [
          {
            start_slot: 34,
            end_slot: 37,
            median_w: 1200,
            start_local: '17:00',
            end_local: '19:00',
          },
        ],
        weekend: [],
      }),
    });
    bucketsAllMock.mockReturnValue([
      {
        day_type: 'weekday',
        slot_index: 6, // 03:00 — low sample count, should fall back to baseload
        median_w: 800, // intentionally high to prove it's ignored
        p25_w: 700,
        p75_w: 900,
        mean_w: 800,
        sample_count: 2,
        updated_at: '2026-01-15T03:17:00Z',
      },
      {
        day_type: 'weekday',
        slot_index: 34, // 17:00 — well-sampled
        median_w: 1200,
        p25_w: 1100,
        p75_w: 1300,
        mean_w: 1200,
        sample_count: 50,
        updated_at: '2026-01-15T03:17:00Z',
      },
    ]);
  });

  it('returns bucket median when sample count is adequate', () => {
    // 2026-01-15 (Thursday) 17:00 UTC = 17:00 local in January (GMT)
    expect(getForecastedConsumptionW(new Date('2026-01-15T17:00:00Z'), 500)).toBe(1200);
  });

  it('returns baseload when bucket sample count is below min threshold', () => {
    // 2026-01-15 03:00 local → slot 6, sample_count 2 < 5 → baseload 320
    expect(getForecastedConsumptionW(new Date('2026-01-15T03:00:00Z'), 500)).toBe(320);
  });

  it('returns fallback when bucket not present at all and baseload is zero', () => {
    // No bucket for slot 20 (10:00); baseload 320 still applies.
    expect(getForecastedConsumptionW(new Date('2026-01-15T10:00:00Z'), 500)).toBe(320);
  });

  it('exposes the learned baseload', () => {
    expect(getBaseloadW()).toBe(320);
  });

  it('exposes the learned high periods', () => {
    const hp = getUsageHighPeriods();
    expect(hp.weekday).toHaveLength(1);
    expect(hp.weekday[0].start_slot).toBe(34);
    expect(hp.weekend).toEqual([]);
  });

  it('returns the full profile via getUsageProfile', () => {
    const profile = getUsageProfile();
    expect(profile).not.toBeNull();
    expect(profile?.meta?.baseload_w).toBe(320);
    expect(profile?.buckets.length).toBe(2);
  });
});

describe('repository — getAverageForecastedConsumptionW', () => {
  beforeEach(() => {
    metaGetMock.mockReturnValue({
      baseload_w: 300,
      baseload_percentile: 10,
      window_days: 14,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-15T00:00:00Z',
      total_samples: 10000,
      computed_at: '2026-01-15T03:17:00Z',
      high_periods_json: '{"weekday":[],"weekend":[]}',
    });
    // Two hours of weekday data: slot 34 (17:00) = 1000W, slot 35 (17:30) = 2000W.
    bucketsAllMock.mockReturnValue([
      {
        day_type: 'weekday',
        slot_index: 34,
        median_w: 1000,
        p25_w: 900,
        p75_w: 1100,
        mean_w: 1000,
        sample_count: 50,
        updated_at: '2026-01-15T03:17:00Z',
      },
      {
        day_type: 'weekday',
        slot_index: 35,
        median_w: 2000,
        p25_w: 1900,
        p75_w: 2100,
        mean_w: 2000,
        sample_count: 50,
        updated_at: '2026-01-15T03:17:00Z',
      },
    ]);
  });

  it('averages over a range of half-hour samples', () => {
    // 2026-01-15 (Thursday) 17:00..18:00 local — two half-hour slots (1000, 2000) → avg 1500.
    const startMs = new Date('2026-01-15T17:00:00Z').getTime();
    const endMs = new Date('2026-01-15T18:00:00Z').getTime();
    expect(getAverageForecastedConsumptionW(startMs, endMs, 500)).toBe(1500);
  });

  it('returns fallback for a degenerate (zero-length) range', () => {
    const t = new Date('2026-01-15T17:00:00Z').getTime();
    expect(getAverageForecastedConsumptionW(t, t, 500)).toBe(500);
  });
});

describe('repository — cache invalidation', () => {
  it('re-reads from DB after invalidateUsageProfileCache', () => {
    metaGetMock.mockReturnValueOnce({
      baseload_w: 250,
      baseload_percentile: 10,
      window_days: 14,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-15T00:00:00Z',
      total_samples: 5000,
      computed_at: '2026-01-15T03:17:00Z',
      high_periods_json: '{"weekday":[],"weekend":[]}',
    });
    bucketsAllMock.mockReturnValue([]);
    expect(getBaseloadW()).toBe(250);

    // Simulate a refresh that raises baseload to 310.
    metaGetMock.mockReturnValueOnce({
      baseload_w: 310,
      baseload_percentile: 10,
      window_days: 14,
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-16T00:00:00Z',
      total_samples: 5500,
      computed_at: '2026-01-16T03:17:00Z',
      high_periods_json: '{"weekday":[],"weekend":[]}',
    });

    // Without invalidation, the cached value is still 250.
    expect(getBaseloadW()).toBe(250);

    invalidateUsageProfileCache();
    expect(getBaseloadW()).toBe(310);
  });
});
