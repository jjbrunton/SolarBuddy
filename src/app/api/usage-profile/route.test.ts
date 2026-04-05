import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getUsageProfileMock,
  getUsageHighPeriodsMock,
  getBaseloadWMock,
} = vi.hoisted(() => ({
  getUsageProfileMock: vi.fn(),
  getUsageHighPeriodsMock: vi.fn(),
  getBaseloadWMock: vi.fn(),
}));

vi.mock('@/lib/usage', () => ({
  getUsageProfile: getUsageProfileMock,
  getUsageHighPeriods: getUsageHighPeriodsMock,
  getBaseloadW: getBaseloadWMock,
}));

import { GET } from './route';

describe('/api/usage-profile GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsageHighPeriodsMock.mockReturnValue([12, 13, 17]);
    getBaseloadWMock.mockReturnValue(420);
  });

  it('returns an empty state when usage profile is unavailable', async () => {
    getUsageProfileMock.mockReturnValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(await response.json()).toEqual({
      status: 'empty',
      reason: 'usage profile not yet computed',
    });
  });

  it('returns usage profile payload when profile is present', async () => {
    getUsageProfileMock.mockReturnValue({
      meta: {
        computed_at: '2026-04-05T08:00:00.000Z',
        window_days: 30,
      },
      buckets: [
        { slot_index: 0, avg_w: 350 },
        { slot_index: 1, avg_w: 340 },
      ],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(await response.json()).toEqual({
      status: 'ok',
      meta: {
        computed_at: '2026-04-05T08:00:00.000Z',
        window_days: 30,
      },
      buckets: [
        { slot_index: 0, avg_w: 350 },
        { slot_index: 1, avg_w: 340 },
      ],
      high_periods: [12, 13, 17],
      baseload_w: 420,
    });
  });
});
