import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  computeUsageProfileMock,
  getUsageProfileMock,
  getUsageHighPeriodsMock,
  getBaseloadWMock,
} = vi.hoisted(() => ({
  computeUsageProfileMock: vi.fn(),
  getUsageProfileMock: vi.fn(),
  getUsageHighPeriodsMock: vi.fn(),
  getBaseloadWMock: vi.fn(),
}));

vi.mock('@/lib/usage', () => ({
  computeUsageProfile: computeUsageProfileMock,
  getUsageProfile: getUsageProfileMock,
  getUsageHighPeriods: getUsageHighPeriodsMock,
  getBaseloadW: getBaseloadWMock,
}));

import { POST } from './route';

describe('/api/usage-profile/refresh POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsageProfileMock.mockReturnValue({
      meta: { computed_at: '2026-04-05T08:00:00.000Z', window_days: 30 },
      buckets: [{ slot_index: 0, avg_w: 420 }],
    });
    getUsageHighPeriodsMock.mockReturnValue([18, 19]);
    getBaseloadWMock.mockReturnValue(380);
  });

  it('returns skipped when computation did not run', async () => {
    computeUsageProfileMock.mockResolvedValue({
      ok: false,
      reason: 'insufficient_samples',
      stats: { reading_count: 40 },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'skipped',
      reason: 'insufficient_samples',
      stats: { reading_count: 40 },
    });
  });

  it('returns profile payload when computation succeeds', async () => {
    computeUsageProfileMock.mockResolvedValue({
      ok: true,
      stats: { reading_count: 1440, days_covered: 30 },
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      stats: { reading_count: 1440, days_covered: 30 },
      meta: { computed_at: '2026-04-05T08:00:00.000Z', window_days: 30 },
      buckets: [{ slot_index: 0, avg_w: 420 }],
      high_periods: [18, 19],
      baseload_w: 380,
    });
  });

  it('returns a 500 response when compute throws', async () => {
    computeUsageProfileMock.mockRejectedValue(new Error('db unavailable'));

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 'error',
      message: 'db unavailable',
    });
  });
});
