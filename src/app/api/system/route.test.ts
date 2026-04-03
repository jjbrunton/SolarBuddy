import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prepareMock,
  getMock,
  getSettingsMock,
  getStateMock,
  statSyncMock,
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  getMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getStateMock: vi.fn(),
  statSyncMock: vi.fn(),
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

vi.mock('fs', () => ({
  default: { statSync: statSyncMock },
  statSync: statSyncMock,
}));

import { GET } from './route';

describe('/api/system', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({ get: getMock });
    getSettingsMock.mockReturnValue({
      octopus_region: 'H',
      auto_schedule: 'true',
      watchdog_enabled: 'true',
    });
    getStateMock.mockReturnValue({ mqtt_connected: true });
  });

  it('returns runtime, health, and database stats', async () => {
    statSyncMock.mockReturnValue({ size: 12345 });
    getMock
      .mockReturnValueOnce({ latest: '2026-04-03T09:30:00Z' })
      .mockReturnValueOnce({ latest: '2026-04-03T09:45:00Z' })
      .mockReturnValueOnce({ count: 111 })
      .mockReturnValueOnce({ count: 22 });

    const response = await GET();
    const payload = await response.json();

    expect(payload.health).toMatchObject({
      mqtt_connected: true,
      rates_fresh: true,
      last_rate_fetch: '2026-04-03T09:30:00Z',
      last_schedule: '2026-04-03T09:45:00Z',
      scheduler_configured: true,
      auto_schedule_enabled: true,
      watchdog_enabled: true,
    });
    expect(payload.stats).toEqual({
      readings_count: 111,
      schedules_count: 22,
      db_size_bytes: 12345,
    });
    expect(payload.about.db_path).toContain('data/solarbuddy.db');
  });

  it('falls back cleanly when the database file is missing and rates are stale', async () => {
    statSyncMock.mockImplementation(() => {
      throw new Error('missing');
    });
    getSettingsMock.mockReturnValue({
      octopus_region: '',
      auto_schedule: 'false',
      watchdog_enabled: 'false',
    });
    getStateMock.mockReturnValue({ mqtt_connected: false });
    getMock
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
