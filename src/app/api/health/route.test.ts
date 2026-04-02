import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    prepareMock.mockReset();
    getMock.mockReset();
  });

  it('returns 200 when the database can be queried', async () => {
    prepareMock.mockReturnValue({ get: getMock });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith('SELECT 1');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      ok: true,
      service: 'solarbuddy',
    });
  });

  it('returns 503 when the database is unavailable', async () => {
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
    });
  });
});

