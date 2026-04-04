import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prepareMock,
  pluckMock,
  getMock,
  getSettingsMock,
  getStateMock,
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  pluckMock: vi.fn(),
  getMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getStateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

vi.mock('@/lib/config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('@/lib/state', () => ({
  getState: getStateMock,
}));

import { GET } from './route';

describe('/api/system', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluckMock.mockReturnValue({ get: getMock });
    prepareMock.mockImplementation((query: string) => {
      if (query.startsWith('PRAGMA')) {
        return { pluck: pluckMock };
      }

      return { get: getMock };
    });
    getSettingsMock.mockReturnValue({
      octopus_region: 'H',
      auto_schedule: 'true',
      watchdog_enabled: 'true',
    });
    getStateMock.mockReturnValue({ mqtt_connected: true });
  });

  it('returns runtime, health, and database stats', async () => {
    const recentRate = new Date(Date.now() - 60_000).toISOString();
    const recentSchedule = new Date(Date.now() - 30_000).toISOString();
    getMock
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4096)
      .mockReturnValueOnce({ latest: recentRate })
      .mockReturnValueOnce({ latest: recentSchedule })
      .mockReturnValueOnce({ count: 111 })
      .mockReturnValueOnce({ count: 22 });

    const response = await GET();
    const payload = await response.json();

    expect(payload.health).toMatchObject({
      mqtt_connected: true,
      rates_fresh: true,
      last_rate_fetch: recentRate,
      last_schedule: recentSchedule,
      scheduler_configured: true,
      auto_schedule_enabled: true,
      watchdog_enabled: true,
    });
    expect(payload.stats).toEqual({
      readings_count: 111,
      schedules_count: 22,
      db_size_bytes: 12288,
    });
    expect(payload.about.db_path).toContain('data/solarbuddy.db');
  });

  it('falls back cleanly when the database file is missing and rates are stale', async () => {
    getSettingsMock.mockReturnValue({
      octopus_region: '',
      auto_schedule: 'false',
      watchdog_enabled: 'false',
    });
    getStateMock.mockReturnValue({ mqtt_connected: false });
    getMock
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(4096)
      .mockReturnValueOnce({ latest: null })
      .mockReturnValueOnce({ latest: null })
      .mockReturnValueOnce({ count: 0 })
      .mockReturnValueOnce({ count: 0 });

    const response = await GET();

    expect((await response.json()).health).toMatchObject({
      mqtt_connected: false,
      rates_fresh: false,
      scheduler_configured: false,
      auto_schedule_enabled: false,
      watchdog_enabled: false,
    });
  });
});
