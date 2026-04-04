import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRecentPlanDataMock, runScheduleCycleMock } = vi.hoisted(() => ({
  getRecentPlanDataMock: vi.fn(),
  runScheduleCycleMock: vi.fn(),
}));

vi.mock('@/lib/db/schedule-repository', () => ({
  getRecentPlanData: getRecentPlanDataMock,
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns recent schedules and plan slots', async () => {
    getRecentPlanDataMock.mockReturnValue({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });
  });

  it.each([
    [{ ok: true, status: 'scheduled' }, 200],
    [{ ok: false, status: 'missing_config' }, 400],
    [{ ok: false, status: 'failed' }, 500],
  ])('maps schedule-cycle status %o to HTTP %i', async (result, expectedStatus) => {
    runScheduleCycleMock.mockResolvedValue(result);
    getRecentPlanDataMock.mockReturnValue({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });

    const response = await POST();

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({
      ...result,
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });
  });
});
