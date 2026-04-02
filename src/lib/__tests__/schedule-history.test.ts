import { describe, expect, it } from 'vitest';
import {
  buildSchedulePlanSlots,
  collectScheduleDays,
  selectScheduleDay,
  toScheduleDayKey,
} from '../schedule-history';

describe('schedule-history', () => {
  it('maps slot timestamps onto UK local day keys', () => {
    expect(toScheduleDayKey('2026-04-01T22:30:00Z')).toBe('2026-04-01');
    expect(toScheduleDayKey('2026-04-01T23:30:00Z')).toBe('2026-04-02');
  });

  it('defaults the selected day to today when it is available', () => {
    expect(
      selectScheduleDay(
        ['2026-03-31', '2026-04-01', '2026-04-02'],
        null,
        '2026-04-01',
      ),
    ).toBe('2026-04-01');
  });

  it('falls back to the newest available day when today is missing', () => {
    expect(
      selectScheduleDay(
        ['2026-03-30', '2026-03-31'],
        null,
        '2026-04-01',
      ),
    ).toBe('2026-03-31');
  });

  it('keeps completed discharge windows visible in historical slots', () => {
    const slots = buildSchedulePlanSlots(
      [
        {
          valid_from: '2026-04-01T17:00:00Z',
          valid_to: '2026-04-01T17:30:00Z',
          price_inc_vat: 32.5,
        },
        {
          valid_from: '2026-04-01T17:30:00Z',
          valid_to: '2026-04-01T18:00:00Z',
          price_inc_vat: 12.25,
        },
      ],
      [
        {
          slot_start: '2026-04-01T17:00:00Z',
          slot_end: '2026-04-01T17:30:00Z',
          status: 'completed',
          type: 'discharge',
        },
      ],
      [],
      [
        {
          slot_start: '2026-04-01T17:30:00Z',
          slot_end: '2026-04-01T18:00:00Z',
          action: 'hold',
        },
      ],
      new Date('2026-04-02T08:00:00Z'),
    );

    expect(slots[0]).toMatchObject({
      plannedAction: 'discharge',
      effectiveAction: 'discharge',
      isPast: true,
    });
    expect(slots[1]).toMatchObject({
      plannedAction: 'do_nothing',
      overrideAction: 'hold',
      effectiveAction: 'hold',
    });
  });

  it('prefers persisted plan-slot actions and reasons when they are available', () => {
    const slots = buildSchedulePlanSlots(
      [
        {
          valid_from: '2026-04-01T12:00:00Z',
          valid_to: '2026-04-01T12:30:00Z',
          price_inc_vat: 5.5,
        },
      ],
      [],
      [
        {
          slot_start: '2026-04-01T12:00:00Z',
          slot_end: '2026-04-01T12:30:00Z',
          action: 'hold',
          reason: 'Solar surplus should cover this slot.',
        },
      ],
      [],
      new Date('2026-04-01T11:00:00Z'),
    );

    expect(slots[0]).toMatchObject({
      plannedAction: 'hold',
      reason: 'Solar surplus should cover this slot.',
    });
  });

  it('collects available days from both rates and stored schedules', () => {
    expect(
      collectScheduleDays(
        [
          {
            valid_from: '2026-04-01T12:00:00Z',
            valid_to: '2026-04-01T12:30:00Z',
            price_inc_vat: 10,
          },
        ],
        [
          {
            slot_start: '2026-04-02T00:30:00Z',
            slot_end: '2026-04-02T01:00:00Z',
            status: 'planned',
            type: 'charge',
          },
        ],
      ),
    ).toEqual(['2026-04-01', '2026-04-02']);
  });
});
