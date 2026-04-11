import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, getMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

import { GET } from './route';

describe('/api/health', () => {
  const originalCommit = process.env.BUILD_COMMIT;
  const originalTime = process.env.BUILD_TIME;

  beforeEach(() => {
    prepareMock.mockReset();
    getMock.mockReset();
    process.env.BUILD_COMMIT = 'abc1234567890deadbeef';
    process.env.BUILD_TIME = '2026-04-11T14:00:00.000Z';
  });

  afterEach(() => {
    if (originalCommit === undefined) delete process.env.BUILD_COMMIT;
    else process.env.BUILD_COMMIT = originalCommit;
    if (originalTime === undefined) delete process.env.BUILD_TIME;
    else process.env.BUILD_TIME = originalTime;
  });

  it('returns 200 with build metadata when the database can be queried', async () => {
    prepareMock.mockReturnValue({ get: getMock });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith('SELECT 1');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      ok: true,
      service: 'solarbuddy',
      build: {
        commit: 'abc1234567890deadbeef',
        commitShort: 'abc1234',
        builtAt: '2026-04-11T14:00:00.000Z',
      },
    });
  });

  it("reports build info as 'unknown' when env vars are not set", async () => {
    delete process.env.BUILD_COMMIT;
    delete process.env.BUILD_TIME;
    prepareMock.mockReturnValue({ get: getMock });

    const response = await GET();
    const payload = await response.json();

    expect(payload.build).toEqual({
      commit: 'unknown',
      commitShort: 'unknown',
      builtAt: 'unknown',
    });
  });

  it('returns 503 with build metadata when the database is unavailable', async () => {
    prepareMock.mockImplementation(() => {
      throw new Error('database offline');
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      ok: false,
      service: 'solarbuddy',
      error: 'Database unavailable',
      build: {
        commit: 'abc1234567890deadbeef',
        commitShort: 'abc1234',
      },
    });
  });
});

