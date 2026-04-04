import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRecentPlanDataMock,
  runScheduleCycleMock,
  getVirtualNowMock,
  getVirtualScheduleDataMock,
  isVirtualModeEnabledMock,
} = vi.hoisted(() => ({
  getRecentPlanDataMock: vi.fn(),
  runScheduleCycleMock: vi.fn(),
  getVirtualNowMock: vi.fn(),
  getVirtualScheduleDataMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(),
}));

vi.mock('@/lib/db/schedule-repository', () => ({
  getRecentPlanData: getRecentPlanDataMock,
}));

vi.mock('@/lib/scheduler/cron', () => ({
  runScheduleCycle: runScheduleCycleMock,
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  getVirtualNow: getVirtualNowMock,
  getVirtualScheduleData: getVirtualScheduleDataMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
}));

import { GET, POST } from './route';

describe('/api/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    isVirtualModeEnabledMock.mockReturnValue(false);
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

  it('returns virtual schedules when virtual mode is active', async () => {
    const now = new Date('2026-04-03T12:00:00Z');
    isVirtualModeEnabledMock.mockReturnValue(true);
    getVirtualNowMock.mockReturnValue(now);
    getVirtualScheduleDataMock.mockReturnValue({
      schedules: [{ id: 'virtual-schedule' }],
      plan_slots: [{ id: 'virtual-plan' }],
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      schedules: [{ id: 'virtual-schedule' }],
      plan_slots: [{ id: 'virtual-plan' }],
    });
    expect(getVirtualScheduleDataMock).toHaveBeenCalledWith(now);
    expect(getRecentPlanDataMock).not.toHaveBeenCalled();
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
