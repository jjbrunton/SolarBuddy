import { describe, expect, it } from 'vitest';
import { expandHalfHourSlotKeys, toSlotKey } from '../slot-key';

describe('toSlotKey', () => {
  it('normalizes slot timestamps to a canonical ISO key', () => {
    expect(toSlotKey('2026-04-01T00:00:00.000Z')).toBe('2026-04-01T00:00:00Z');
    expect(toSlotKey(new Date('2026-04-01T00:00:00Z'))).toBe('2026-04-01T00:00:00Z');
  });

  it('keeps repeated wall-clock slots distinct across the DST fallback hour', () => {
    expect(toSlotKey('2026-10-25T00:30:00Z')).not.toBe(toSlotKey('2026-10-25T01:30:00Z'));
  });
});

describe('expandHalfHourSlotKeys', () => {
  it('expands a charge window into normalized half-hour slot keys', () => {
    expect(expandHalfHourSlotKeys('2026-04-01T00:00:00Z', '2026-04-01T01:30:00Z')).toEqual([
      '2026-04-01T00:00:00Z',
      '2026-04-01T00:30:00Z',
      '2026-04-01T01:00:00Z',
    ]);
  });
});
