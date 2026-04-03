import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, allMock, runScheduleCycleMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  runScheduleCycleMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

vi.mock('@/lib/scheduler/cron', () => ({
  runScheduleCycle: runScheduleCycleMock,
}));

import { GET, POST } from './route';

describe('/api/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    prepareMock.mockReturnValue({ all: allMock });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns recent schedules and plan slots', async () => {
    allMock.mockReturnValueOnce([{ id: 'schedule' }]).mockReturnValueOnce([{ id: 'plan' }]);

    const response = await GET();

    expect(await response.json()).toEqual({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });
    expect(allMock).toHaveBeenNthCalledWith(1, '2026-03-04T00:00:00.000Z');
    expect(allMock).toHaveBeenNthCalledWith(2, '2026-03-04T00:00:00.000Z');
  });

  it.each([
    [{ ok: true, status: 'scheduled' }, 200],
    [{ ok: false, status: 'missing_config' }, 400],
    [{ ok: false, status: 'failed' }, 500],
  ])('maps schedule-cycle status %o to HTTP %i', async (result, expectedStatus) => {
    runScheduleCycleMock.mockResolvedValue(result);
    allMock.mockReturnValueOnce([{ id: 'schedule' }]).mockReturnValueOnce([{ id: 'plan' }]);

    const response = await POST();

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({
      ...result,
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });
  });
});
