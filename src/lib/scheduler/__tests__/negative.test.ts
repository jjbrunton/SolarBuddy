import { describe, expect, it } from 'vitest';
import { findNegativePriceSlots, findPreDischargeSlots } from '../negative';
import type { AgileRate } from '../../octopus/rates';
import type { AppSettings } from '../../config';

const baseSettings = {
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
} as AppSettings;

function rate(valid_from: string, valid_to: string, price: number): AgileRate {
  return { valid_from, valid_to, price_inc_vat: price, price_exc_vat: price };
}

const rates: AgileRate[] = [
  rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', 5),
  rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', -2),
  rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -3),
  rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', 4),
  rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', -1),
  rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', 6),
];

describe('findNegativePriceSlots', () => {
  it('finds all negative price slots and merges adjacent ones', () => {
    const windows = findNegativePriceSlots(rates, baseSettings);
    expect(windows).toHaveLength(2);
    // First window: two adjacent negative slots merged
    expect(windows[0].slot_start).toBe('2026-04-01T01:30:00Z');
    expect(windows[0].slot_end).toBe('2026-04-01T02:30:00Z');
    expect(windows[0].slots).toHaveLength(2);
    // Second window: isolated negative slot
    expect(windows[1].slot_start).toBe('2026-04-01T03:00:00Z');
    expect(windows[1].slot_end).toBe('2026-04-01T03:30:00Z');
  });

  it('returns empty when disabled', () => {
    const windows = findNegativePriceSlots(rates, {
      ...baseSettings,
      negative_price_charging: 'false',
    } as AppSettings);
    expect(windows).toHaveLength(0);
  });

  it('returns empty when no negative rates exist', () => {
    const positiveRates = rates.filter((r) => r.price_inc_vat >= 0);
    const windows = findNegativePriceSlots(positiveRates, baseSettings);
    expect(windows).toHaveLength(0);
  });
});

describe('findPreDischargeSlots', () => {
  it('returns empty when disabled', () => {
    const negWindows = findNegativePriceSlots(rates, baseSettings);
    const discharge = findPreDischargeSlots(rates, negWindows, baseSettings);
    expect(discharge).toHaveLength(0);
  });

  it('finds pre-discharge slots before negative windows', () => {
    const settings = { ...baseSettings, negative_price_pre_discharge: 'true' } as AppSettings;
    const negWindows = findNegativePriceSlots(rates, settings);
    const discharge = findPreDischargeSlots(rates, negWindows, settings);

    // Should find the slot before the first negative window (01:00-01:30 @ 5p)
    // and the slot before the second (02:30-03:00 @ 4p)
    expect(discharge).toHaveLength(2);
    expect(discharge[0].slots[0].valid_from).toBe('2026-04-01T01:00:00Z');
    expect(discharge[0].type).toBe('discharge');
    expect(discharge[1].slots[0].valid_from).toBe('2026-04-01T02:30:00Z');
    expect(discharge[1].type).toBe('discharge');
  });

  it('skips pre-discharge when preceding slot is also negative', () => {
    // The second negative slot (02:00) is preceded by another negative (01:30)
    // so no discharge should be created for slot 02:00 individually
    // (already handled by merging — the first window starts at 01:30)
    const settings = { ...baseSettings, negative_price_pre_discharge: 'true' } as AppSettings;
    const negWindows = findNegativePriceSlots(rates, settings);
    const discharge = findPreDischargeSlots(rates, negWindows, settings);
    // Pre-discharge is based on window start, not individual slots
    // Window 1 starts at 01:30, pre-slot is 01:00 (positive) — included
    // Window 2 starts at 03:00, pre-slot is 02:30 (positive) — included
    expect(discharge.every((d) => d.slots.every((s) => s.price_inc_vat >= 0))).toBe(true);
  });
});
