import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeWindow, PlannedSlot } from '../engine';

const {
  persistSchedulePlanMock,
  scheduleExecutionMock,
  appendEventMock,
  notifyMock,
} = vi.hoisted(() => ({
  persistSchedulePlanMock: vi.fn(),
  scheduleExecutionMock: vi.fn(),
  appendEventMock: vi.fn(),
  notifyMock: vi.fn(),
}));

const windows: ChargeWindow[] = [
  {
    slot_start: '2026-04-01T12:00:00Z',
    slot_end: '2026-04-01T12:30:00Z',
    avg_price: 8,
    slots: [],
  },
  {
    slot_start: '2026-04-01T17:00:00Z',
    slot_end: '2026-04-01T17:30:00Z',
    avg_price: 31,
    slots: [],
    type: 'discharge',
  },
];

const plannedSlots: PlannedSlot[] = [
  {
    slot_start: '2026-04-01T11:30:00Z',
    slot_end: '2026-04-01T12:00:00Z',
    action: 'hold',
    reason: 'Hold battery for a better discharge opportunity later in the tariff horizon.',
    expected_soc_after: 68,
    expected_value: null,
  },
  {
    slot_start: '2026-04-01T12:00:00Z',
    slot_end: '2026-04-01T12:30:00Z',
    action: 'charge',
    reason: 'Charge slot selected by the planner.',
    expected_soc_after: 78,
    expected_value: -8,
  },
  {
    slot_start: '2026-04-01T17:00:00Z',
    slot_end: '2026-04-01T17:30:00Z',
    action: 'discharge',
    reason: 'Discharge slot selected by the arbitrage planner.',
    expected_soc_after: 58,
    expected_value: 31,
  },
];

vi.mock('../../config', () => ({
  getSettings: () => ({
    octopus_region: 'H',
    tariff_type: 'agile',
    auto_schedule: 'true',
    charging_strategy: 'opportunistic_topup',
  }),
}));

vi.mock('../../octopus/rates', () => ({
  resolveRates: vi.fn().mockResolvedValue([
    {
      valid_from: '2026-04-01T12:00:00Z',
      valid_to: '2026-04-01T12:30:00Z',
      price_inc_vat: 8,
      price_exc_vat: 8,
    },
  ]),
}));

vi.mock('../../octopus/export-rates', () => ({
  resolveExportRates: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../state', () => ({
  getState: () => ({ battery_soc: 70 }),
}));

let currentPlanWindows: ChargeWindow[] = windows;
let currentPlanSlots: PlannedSlot[] = plannedSlots;

vi.mock('../engine', () => ({
  getChargingStrategy: () => 'opportunistic_topup',
  buildSchedulePlan: () => ({
    windows: currentPlanWindows,
    slots: currentPlanSlots,
  }),
}));

vi.mock('../executor', () => ({
  scheduleExecution: scheduleExecutionMock,
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

vi.mock('../../db/schedule-repository', () => ({
  persistSchedulePlan: persistSchedulePlanMock,
}));

vi.mock('../../notifications/dispatcher', () => ({
  notify: notifyMock,
}));

import { runScheduleCycle, _resetCronStateForTests } from '../cron';

describe('runScheduleCycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T10:15:00Z'));
    persistSchedulePlanMock.mockClear();
    scheduleExecutionMock.mockClear();
    appendEventMock.mockClear();
    notifyMock.mockClear();
    currentPlanWindows = windows;
    currentPlanSlots = plannedSlots;
    _resetCronStateForTests();
  });

  it('persists the schedule plan and executes windows', async () => {
    const result = await runScheduleCycle();

    expect(result).toMatchObject({
      ok: true,
      status: 'scheduled',
      windowsCount: 2,
    });
    expect(persistSchedulePlanMock).toHaveBeenCalledWith(windows, plannedSlots);
    expect(scheduleExecutionMock).toHaveBeenCalledWith(windows);
    expect(appendEventMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'success',
      category: 'scheduler',
    }));
  });

  it('does not send duplicate notifications for the same plan', async () => {
    await runScheduleCycle();
    expect(notifyMock).toHaveBeenCalledTimes(1);

    notifyMock.mockClear();
    await runScheduleCycle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not re-notify when only slot_start rolls forward (time passes)', async () => {
    await runScheduleCycle();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    notifyMock.mockClear();

    // Simulate a replan 30 min later: the past slot gets filtered out, so the
    // charge window's start advances even though the plan's end shape is
    // unchanged.
    currentPlanWindows = [
      { ...windows[0], slot_start: '2026-04-01T12:30:00Z' },
      windows[1],
    ];
    await runScheduleCycle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not re-notify when only avg_price changes', async () => {
    await runScheduleCycle();
    notifyMock.mockClear();

    currentPlanWindows = [
      { ...windows[0], avg_price: -9.4 },
      { ...windows[1], avg_price: 15.9 },
    ];
    await runScheduleCycle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does not re-notify when slot_end jitters by less than 30 min', async () => {
    await runScheduleCycle();
    notifyMock.mockClear();

    // Same half-hour slot end, different sub-minute precision.
    currentPlanWindows = [
      { ...windows[0], slot_end: '2026-04-01T12:30:00.500Z' },
      windows[1],
    ];
    await runScheduleCycle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('notifies when a new window is added', async () => {
    await runScheduleCycle();
    notifyMock.mockClear();

    currentPlanWindows = [
      ...windows,
      {
        slot_start: '2026-04-01T20:00:00Z',
        slot_end: '2026-04-01T20:30:00Z',
        avg_price: 9,
        slots: [],
      },
    ];
    await runScheduleCycle();
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('notifies when a window end time shifts by 30 min', async () => {
    await runScheduleCycle();
    notifyMock.mockClear();

    currentPlanWindows = [
      { ...windows[0], slot_end: '2026-04-01T13:00:00Z' },
      windows[1],
    ];
    await runScheduleCycle();
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('notifies when a window type flips', async () => {
    await runScheduleCycle();
    notifyMock.mockClear();

    currentPlanWindows = [
      { ...windows[0], type: 'discharge' },
      windows[1],
    ];
    await runScheduleCycle();
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});
