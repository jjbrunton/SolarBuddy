import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeWindow } from '../engine';

const { reconcileInverterState, updateScheduleStatus } = vi.hoisted(() => ({
  reconcileInverterState: vi.fn().mockResolvedValue(undefined),
  updateScheduleStatus: vi.fn(),
}));

vi.mock('../watchdog', () => ({
  reconcileInverterState,
}));

vi.mock('../../db/schedule-repository', () => ({
  updateScheduleStatus,
}));

import { clearScheduledTimers, scheduleExecution } from '../executor';

describe('scheduleExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T11:05:00Z'));
    reconcileInverterState.mockClear();
    updateScheduleStatus.mockClear();
  });

  afterEach(() => {
    clearScheduledTimers();
    vi.useRealTimers();
  });

  it('transitions the schedule to active and triggers the watchdog at window start', async () => {
    const windows: ChargeWindow[] = [
      {
        slot_start: '2026-03-30T11:10:00Z',
        slot_end: '2026-03-30T11:40:00Z',
        avg_price: 1,
        slots: [],
      },
    ];

    scheduleExecution(windows);

    // Nothing should fire before the window starts.
    expect(updateScheduleStatus).not.toHaveBeenCalled();
    expect(reconcileInverterState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(updateScheduleStatus).toHaveBeenCalledWith(
      '2026-03-30T11:10:00Z',
      '2026-03-30T11:40:00Z',
      undefined,
      'active',
    );
    expect(reconcileInverterState).toHaveBeenCalledTimes(1);
    expect(reconcileInverterState.mock.calls[0][0]).toMatch(/window start/);
  });

  it('transitions the schedule to completed and re-reconciles at window end', async () => {
    const windows: ChargeWindow[] = [
      {
        slot_start: '2026-03-30T11:10:00Z',
        slot_end: '2026-03-30T11:40:00Z',
        avg_price: 1,
        slots: [],
      },
    ];

    scheduleExecution(windows);

    // Advance past the window end so both timers have fired.
    await vi.advanceTimersByTimeAsync(40 * 60 * 1000);

    const statuses = updateScheduleStatus.mock.calls.map((call) => call[3]);
    expect(statuses).toEqual(['active', 'completed']);
    expect(reconcileInverterState).toHaveBeenCalledTimes(2);
    expect(reconcileInverterState.mock.calls[1][0]).toMatch(/window end/);
  });

  it('forwards the discharge window type to updateScheduleStatus', async () => {
    const windows: ChargeWindow[] = [
      {
        slot_start: '2026-03-30T12:00:00Z',
        slot_end: '2026-03-30T12:30:00Z',
        avg_price: 30,
        slots: [],
        type: 'discharge',
      },
    ];

    scheduleExecution(windows);
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000);

    const types = updateScheduleStatus.mock.calls.map((call) => call[2]);
    expect(types).toEqual(['discharge', 'discharge']);
  });

  it('skips windows that have already ended', async () => {
    const windows: ChargeWindow[] = [
      {
        slot_start: '2026-03-30T10:00:00Z',
        slot_end: '2026-03-30T10:30:00Z',
        avg_price: 1,
        slots: [],
      },
    ];

    scheduleExecution(windows);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(updateScheduleStatus).not.toHaveBeenCalled();
    expect(reconcileInverterState).not.toHaveBeenCalled();
  });
});
