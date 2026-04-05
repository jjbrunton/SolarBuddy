import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readingsAllMock,
  insertBucketMock,
  clearBucketsMock,
  clearMetaMock,
  insertMetaMock,
  transactionMock,
  getSettingsMock,
  getUsageProfileMock,
  invalidateCacheMock,
  requestReplanMock,
} = vi.hoisted(() => ({
  readingsAllMock: vi.fn(),
  insertBucketMock: vi.fn(),
  clearBucketsMock: vi.fn(),
  clearMetaMock: vi.fn(),
  insertMetaMock: vi.fn(),
  transactionMock: vi.fn((fn: () => void) => fn),
  getSettingsMock: vi.fn(),
  getUsageProfileMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  requestReplanMock: vi.fn(),
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT timestamp, load_power FROM readings')) {
        return { all: readingsAllMock };
      }
      if (sql.startsWith('INSERT INTO usage_profile_meta')) {
        return { run: insertMetaMock };
      }
      if (sql.startsWith('INSERT INTO usage_profile')) {
        return { run: insertBucketMock };
      }
      if (sql.startsWith('DELETE FROM usage_profile_meta')) {
        return { run: clearMetaMock };
      }
      if (sql.startsWith('DELETE FROM usage_profile')) {
        return { run: clearBucketsMock };
      }
      return { all: vi.fn(), run: vi.fn(), get: vi.fn() };
    },
    transaction: transactionMock,
  }),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('../repository', () => ({
  getUsageProfile: getUsageProfileMock,
  invalidateUsageProfileCache: invalidateCacheMock,
}));

vi.mock('../../scheduler/reevaluate', () => ({
  requestReplan: requestReplanMock,
}));

import { computeUsageProfile } from '../compute';

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Europe/London';
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function defaultSettings() {
  return {
    usage_learning_enabled: 'true',
    usage_learning_window_days: '14',
    usage_baseload_percentile: '10',
    usage_high_period_multiplier: '1.5',
    usage_high_period_min_slots: '2',
    usage_min_samples_per_bucket: '5',
  };
}

/**
 * Generate synthetic readings: 288 samples per day (every 5 minutes) over 14 days,
 * starting Monday 2026-01-05. Weekdays: 300W flat with 1200W peak at slots 34–37
 * (17:00–18:30). Weekends: 400W flat.
 */
function generateSyntheticReadings() {
  const rows: Array<{ timestamp: string; load_power: number }> = [];
  const startMs = new Date('2026-01-05T00:00:00Z').getTime(); // Monday, UK GMT (no DST)
  const FIVE_MIN = 5 * 60 * 1000;
  const HALF_HOUR_MS = 30 * 60 * 1000;
  for (let day = 0; day < 14; day++) {
    const dayStartMs = startMs + day * 24 * 60 * 60 * 1000;
    const dayDate = new Date(dayStartMs);
    const dow = dayDate.getDay();
    const isWeekend = dow === 0 || dow === 6;
    for (let i = 0; i < 288; i++) {
      const ts = dayStartMs + i * FIVE_MIN;
      const slotIndex = Math.floor((ts - dayStartMs) / HALF_HOUR_MS);
      let load: number;
      if (isWeekend) {
        load = 400;
      } else if (slotIndex >= 34 && slotIndex <= 37) {
        load = 1200;
      } else {
        load = 300;
      }
      rows.push({ timestamp: new Date(ts).toISOString(), load_power: load });
    }
  }
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation((fn: () => void) => fn);
  getSettingsMock.mockReturnValue(defaultSettings());
  getUsageProfileMock.mockReturnValue(null);
});

describe('computeUsageProfile', () => {
  it('computes percentiles, baseload, and high periods from synthetic data', async () => {
    readingsAllMock.mockReturnValue(generateSyntheticReadings());

    const result = await computeUsageProfile({
      now: new Date('2026-01-19T00:00:00Z'), // day after the synthetic window
    });

    expect(result.ok).toBe(true);
    expect(result.stats.total_samples).toBe(288 * 14);
    expect(result.stats.weekday_samples).toBe(288 * 10);
    expect(result.stats.weekend_samples).toBe(288 * 4);
    expect(result.stats.dropped_days).toBe(0);

    const profile = result.profile!;
    expect(profile.meta?.baseload_w).toBe(300); // p10 of the combined distribution

    // Weekday slot 34 (17:00) should have median 1200 — this is the evening peak.
    const weekdayPeakBucket = profile.buckets.find(
      (b) => b.day_type === 'weekday' && b.slot_index === 34,
    );
    expect(weekdayPeakBucket?.median_w).toBe(1200);
    expect(weekdayPeakBucket!.sample_count).toBeGreaterThan(0);

    // Weekday slot 10 (05:00) should be 300W baseload.
    const weekdayBaseBucket = profile.buckets.find(
      (b) => b.day_type === 'weekday' && b.slot_index === 10,
    );
    expect(weekdayBaseBucket?.median_w).toBe(300);

    // Weekend buckets are all 400W.
    const weekendBucket = profile.buckets.find(
      (b) => b.day_type === 'weekend' && b.slot_index === 20,
    );
    expect(weekendBucket?.median_w).toBe(400);

    // High periods: weekday should detect 34..37; weekend should be empty (400 < 450 threshold).
    expect(profile.meta?.high_periods.weekday).toHaveLength(1);
    expect(profile.meta?.high_periods.weekday[0].start_slot).toBe(34);
    expect(profile.meta?.high_periods.weekday[0].end_slot).toBe(37);
    expect(profile.meta?.high_periods.weekend).toEqual([]);
  });

  it('writes all 96 buckets plus meta in a single transaction', async () => {
    readingsAllMock.mockReturnValue(generateSyntheticReadings());

    await computeUsageProfile({ now: new Date('2026-01-19T00:00:00Z') });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(clearBucketsMock).toHaveBeenCalledTimes(1);
    expect(clearMetaMock).toHaveBeenCalledTimes(1);
    expect(insertBucketMock).toHaveBeenCalledTimes(96);
    expect(insertMetaMock).toHaveBeenCalledTimes(1);
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to write when total samples are below minimum required', async () => {
    // Tiny sample set, well under 2 * 14 * 24 = 672
    readingsAllMock.mockReturnValue([
      { timestamp: '2026-01-15T12:00:00Z', load_power: 500 },
      { timestamp: '2026-01-15T12:05:00Z', load_power: 550 },
    ]);

    const result = await computeUsageProfile({ now: new Date('2026-01-19T00:00:00Z') });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('insufficient data');
    // Must not touch the tables on the insufficient-data path.
    expect(transactionMock).not.toHaveBeenCalled();
    expect(insertBucketMock).not.toHaveBeenCalled();
    expect(insertMetaMock).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it('drops days with fewer than the minimum per-day samples', async () => {
    const rows = generateSyntheticReadings();
    // Simulate a bad day: keep only 100 samples for 2026-01-15 (Thursday).
    const truncated = rows.filter((r) => {
      if (!r.timestamp.startsWith('2026-01-15')) return true;
      const ms = new Date(r.timestamp).getTime();
      const minutes = Math.floor((ms / (5 * 60 * 1000)) % 288);
      return minutes < 100;
    });
    readingsAllMock.mockReturnValue(truncated);

    const result = await computeUsageProfile({ now: new Date('2026-01-19T00:00:00Z') });

    expect(result.ok).toBe(true);
    expect(result.stats.dropped_days).toBeGreaterThanOrEqual(1);
  });

  it('does not trigger a replan when there is no meaningful drift', async () => {
    readingsAllMock.mockReturnValue(generateSyntheticReadings());
    // Simulate an existing profile identical to what computeUsageProfile would produce.
    getUsageProfileMock.mockReturnValue({
      buckets: Array.from({ length: 96 }, (_, idx) => ({
        day_type: idx < 48 ? 'weekday' : 'weekend',
        slot_index: idx % 48,
        median_w:
          idx < 48
            ? (idx % 48) >= 34 && (idx % 48) <= 37
              ? 1200
              : 300
            : 400,
        p25_w: 100,
        p75_w: 100,
        mean_w: 100,
        sample_count: 60,
        updated_at: '',
      })),
      meta: {
        baseload_w: 300,
        baseload_percentile: 10,
        window_days: 14,
        window_start: '2026-01-01T00:00:00Z',
        window_end: '2026-01-15T00:00:00Z',
        total_samples: 4032,
        computed_at: '2026-01-15T03:17:00Z',
        high_periods: { weekday: [], weekend: [] },
      },
    });

    await computeUsageProfile({ now: new Date('2026-01-19T00:00:00Z') });

    expect(requestReplanMock).not.toHaveBeenCalled();
  });
});
