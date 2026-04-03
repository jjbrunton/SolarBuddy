import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, allMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

import { GET } from './route';

describe('/api/readings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    prepareMock.mockReturnValue({ all: allMock });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today readings plus seven-day summaries', async () => {
    allMock.mockReturnValueOnce([{ timestamp: 'a' }]).mockReturnValueOnce([{ date: '2026-04-03' }]);
    const todayStart = new Date('2026-04-03T10:15:00Z');
    todayStart.setHours(0, 0, 0, 0);

    const response = await GET(new Request('http://localhost/api/readings?period=today'));

    expect(await response.json()).toEqual({
      readings: [{ timestamp: 'a' }],
      daily: [{ date: '2026-04-03' }],
    });
    expect(allMock).toHaveBeenNthCalledWith(1, todayStart.toISOString());
  });

  it('returns empty arrays for unsupported periods', async () => {
    const response = await GET(new Request('http://localhost/api/readings?period=30d'));

    expect(await response.json()).toEqual({ readings: [], daily: [] });
  });
});
