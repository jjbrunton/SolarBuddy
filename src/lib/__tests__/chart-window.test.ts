import { describe, expect, it } from 'vitest';
import {
  findCurrentOrNextTimeWindowIndex,
  sliceTimeWindowsFromCurrentPeriod,
} from '../chart-window';

const slots = [
  {
    start: '2026-04-09T08:00:00Z',
    end: '2026-04-09T08:30:00Z',
    label: '08:00',
  },
  {
    start: '2026-04-09T08:30:00Z',
    end: '2026-04-09T09:00:00Z',
    label: '08:30',
  },
  {
    start: '2026-04-09T09:00:00Z',
    end: '2026-04-09T09:30:00Z',
    label: '09:00',
  },
];

describe('chart-window', () => {
  it('starts the chart at the current time window when one is active', () => {
    expect(
      findCurrentOrNextTimeWindowIndex(
        slots,
        (slot) => slot.start,
        (slot) => slot.end,
        new Date('2026-04-09T08:40:00Z'),
      ),
    ).toBe(1);
  });

  it('starts the chart at the next upcoming window when the current time is between slots', () => {
    const gapSlots = [
      { start: '2026-04-09T08:00:00Z', end: '2026-04-09T08:30:00Z', label: '08:00' },
      { start: '2026-04-09T09:00:00Z', end: '2026-04-09T09:30:00Z', label: '09:00' },
    ];

    expect(
      sliceTimeWindowsFromCurrentPeriod(
        gapSlots,
        (slot) => slot.start,
        (slot) => slot.end,
        new Date('2026-04-09T08:45:00Z'),
      ).map((slot) => slot.label),
    ).toEqual(['09:00']);
  });

  it('keeps the full series when every window is already in the past', () => {
    expect(
      sliceTimeWindowsFromCurrentPeriod(
        slots,
        (slot) => slot.start,
        (slot) => slot.end,
        new Date('2026-04-09T10:00:00Z'),
      ).map((slot) => slot.label),
    ).toEqual(['08:00', '08:30', '09:00']);
  });
});
