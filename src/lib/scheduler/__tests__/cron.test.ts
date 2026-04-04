import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeWindow, PlannedSlot } from '../engine';

const {
  persistSchedulePlanMock,
  scheduleExecutionMock,
  appendEventMock,
} = vi.hoisted(() => ({
  persistSchedulePlanMock: vi.fn(),
  scheduleExecutionMock: vi.fn(),
  appendEventMock: vi.fn(),
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

vi.mock('../engine', () => ({
  getChargingStrategy: () => 'opportunistic_topup',
  buildSchedulePlan: () => ({
    windows,
    slots: plannedSlots,
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

import { runScheduleCycle } from '../cron';

describe('runScheduleCycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T10:15:00Z'));
    persistSchedulePlanMock.mockClear();
    scheduleExecutionMock.mockClear();
    appendEventMock.mockClear();
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
});
