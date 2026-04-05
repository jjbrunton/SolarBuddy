import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRecentPlanDataMock,
  runScheduleCycleMock,
  getVirtualNowMock,
  getVirtualScheduleDataMock,
  isVirtualModeEnabledMock,
  getResolvedSlotActionMock,
} = vi.hoisted(() => ({
  getRecentPlanDataMock: vi.fn(),
  runScheduleCycleMock: vi.fn(),
  getVirtualNowMock: vi.fn(),
  getVirtualScheduleDataMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(),
  getResolvedSlotActionMock: vi.fn(),
}));

vi.mock('@/lib/db/schedule-repository', () => ({
  getRecentPlanData: getRecentPlanDataMock,
}));

vi.mock('@/lib/scheduler/cron', () => ({
  runScheduleCycle: runScheduleCycleMock,
}));

vi.mock('@/lib/scheduler/watchdog', () => ({
  getResolvedSlotAction: getResolvedSlotActionMock,
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  getVirtualNow: getVirtualNowMock,
  getVirtualScheduleData: getVirtualScheduleDataMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
}));

import { GET, POST } from './route';

describe('/api/schedule', () => {
  const resolvedAction = {
    action: 'charge',
    source: 'plan',
    reason: 'scheduled_slot',
    detail: 'Planned charge action is active for the current slot.',
    slotStart: '2026-04-03T10:00:00Z',
    slotEnd: '2026-04-03T10:30:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
    isVirtualModeEnabledMock.mockReturnValue(false);
    getResolvedSlotActionMock.mockReturnValue(resolvedAction);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns recent schedules, plan slots, and the resolved current action', async () => {
    getRecentPlanDataMock.mockReturnValue({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      schedules: [{ id: 'schedule' }],
      plan_slots: [{ id: 'plan' }],
      current_action: resolvedAction,
    });
    expect(getResolvedSlotActionMock).toHaveBeenCalledTimes(1);
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
      current_action: resolvedAction,
    });
    expect(getVirtualScheduleDataMock).toHaveBeenCalledWith(now);
    expect(getRecentPlanDataMock).not.toHaveBeenCalled();
    // Virtual mode must resolve at the virtual "now", not the wall clock.
    expect(getResolvedSlotActionMock).toHaveBeenCalledWith(now);
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
      current_action: resolvedAction,
    });
  });
});
