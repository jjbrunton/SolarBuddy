import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { localHalfHourIndex, localDayType, slotIndexToLocalTime } from '../slot-index';

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  // Pin timezone so local-time accessors behave deterministically across CI
  // environments. UK timezone includes DST transitions, which the DST-specific
  // tests further down exercise.
  process.env.TZ = 'Europe/London';
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe('localHalfHourIndex', () => {
  it('returns 0 for midnight local', () => {
    expect(localHalfHourIndex(new Date('2026-01-15T00:00:00Z'))).toBe(0);
  });

  it('returns 47 for 23:30 local', () => {
    // UK in January = GMT (no DST), so UTC matches local.
    expect(localHalfHourIndex(new Date('2026-01-15T23:30:00Z'))).toBe(47);
  });

  it('returns 34 for 17:00 local', () => {
    expect(localHalfHourIndex(new Date('2026-01-15T17:00:00Z'))).toBe(34);
  });

  it('returns 35 for 17:30 local', () => {
    expect(localHalfHourIndex(new Date('2026-01-15T17:30:00Z'))).toBe(35);
  });

  it('returns 35 for 17:45 local (rounds down to the enclosing half-hour)', () => {
    expect(localHalfHourIndex(new Date('2026-01-15T17:45:00Z'))).toBe(35);
  });

  it('respects BST in summer (UTC shifts back by one hour)', () => {
    // 2026-07-15 17:00 UTC = 18:00 BST (local) → slot 36
    expect(localHalfHourIndex(new Date('2026-07-15T17:00:00Z'))).toBe(36);
  });
});

describe('localDayType', () => {
  it('classifies Monday through Friday as weekday', () => {
    // 2026-01-12 is a Monday, 2026-01-16 is a Friday.
    for (const day of [12, 13, 14, 15, 16]) {
      const d = new Date(`2026-01-${String(day).padStart(2, '0')}T12:00:00Z`);
      expect(localDayType(d)).toBe('weekday');
    }
  });

  it('classifies Saturday and Sunday as weekend', () => {
    // 2026-01-17 is a Saturday, 2026-01-18 is a Sunday.
    expect(localDayType(new Date('2026-01-17T12:00:00Z'))).toBe('weekend');
    expect(localDayType(new Date('2026-01-18T12:00:00Z'))).toBe('weekend');
  });
});

describe('slotIndexToLocalTime', () => {
  it('renders slot 0 as 00:00', () => {
    expect(slotIndexToLocalTime(0)).toBe('00:00');
  });

  it('renders slot 1 as 00:30', () => {
    expect(slotIndexToLocalTime(1)).toBe('00:30');
  });

  it('renders slot 34 as 17:00', () => {
    expect(slotIndexToLocalTime(34)).toBe('17:00');
  });

  it('renders slot 47 as 23:30', () => {
    expect(slotIndexToLocalTime(47)).toBe('23:30');
  });

  it('clamps out-of-range inputs', () => {
    expect(slotIndexToLocalTime(-5)).toBe('00:00');
    expect(slotIndexToLocalTime(200)).toBe('23:30');
  });
});

describe('DST edge cases (Europe/London)', () => {
  it('handles spring-forward day without crashing', () => {
    // UK clocks jump from 01:00 GMT to 02:00 BST on 2026-03-29.
    // 00:30 UTC on that day = 00:30 local (pre-jump).
    const d = new Date('2026-03-29T00:30:00Z');
    expect(() => localHalfHourIndex(d)).not.toThrow();
    expect(() => localDayType(d)).not.toThrow();
    expect(localDayType(d)).toBe('weekend'); // 2026-03-29 is a Sunday
  });

  it('handles fall-back day without crashing', () => {
    // UK clocks jump from 02:00 BST to 01:00 GMT on 2026-10-25.
    const d = new Date('2026-10-25T01:30:00Z'); // 01:30 GMT = 01:30 local (post-jump)
    expect(() => localHalfHourIndex(d)).not.toThrow();
    expect(localDayType(d)).toBe('weekend'); // 2026-10-25 is a Sunday
  });
});
