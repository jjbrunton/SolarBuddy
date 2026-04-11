import { describe, expect, it } from 'vitest';
import { findAlwaysCheapSlots, findNegativePriceSlots, findNegativeRunDischargeSlots, findPreDischargeSlots } from '../negative';
import type { AgileRate } from '../../octopus/rates';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';

const baseSettings = {
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
} as AppSettings;

// Settings used by the multi-slot walk-back tests. Defaults give a generous
// energy budget (3.6 kW charge × 0.5 h = 1.8 kWh per refill slot, 500 W load
// = 0.25 kWh per drained slot → ~7 pre-discharge slots offset by one negative
// slot) so the walk-back is bounded by adjacency, not energy.
const enabledSettings = {
  ...DEFAULT_SETTINGS,
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'true',
  battery_capacity_kwh: '10',
  max_charge_power_kw: '3.6',
  charge_rate: '100',
  estimated_consumption_w: '500',
  discharge_soc_floor: '20',
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

  it('walks back through multiple consecutive positive slots before a negative window', () => {
    // Two positive slots ramping into a long negative window. The energy
    // budget (10 kWh battery, 500 W load, 16 negative slots) is generous,
    // so both positive slots should be claimed.
    const ramp: AgileRate[] = [
      rate('2026-04-11T20:30:00Z', '2026-04-11T21:00:00Z', 1.89),
      rate('2026-04-11T21:00:00Z', '2026-04-11T21:30:00Z', 2.35),
      rate('2026-04-11T21:30:00Z', '2026-04-11T22:00:00Z', -1.04),
      rate('2026-04-11T22:00:00Z', '2026-04-11T22:30:00Z', -1.30),
      rate('2026-04-11T22:30:00Z', '2026-04-11T23:00:00Z', -3.93),
    ];
    const negWindows = findNegativePriceSlots(ramp, enabledSettings);
    const discharge = findPreDischargeSlots(ramp, negWindows, enabledSettings, {
      currentSoc: 51,
    });

    expect(discharge).toHaveLength(1);
    expect(discharge[0].type).toBe('discharge');
    expect(discharge[0].slots).toHaveLength(2);
    expect(discharge[0].slots.map((s) => s.valid_from)).toEqual([
      '2026-04-11T20:30:00Z',
      '2026-04-11T21:00:00Z',
    ]);
  });

  it('stops walking back when the SOC headroom above the discharge floor is exhausted', () => {
    // Three positive slots before a negative window, but currentSoc=25 with
    // a 20% floor leaves only 5% × 10 kWh = 0.5 kWh of headroom = 2 slots
    // worth of drain (0.25 kWh each). The third slot must NOT be claimed.
    const ramp: AgileRate[] = [
      rate('2026-04-11T19:30:00Z', '2026-04-11T20:00:00Z', 3.0),
      rate('2026-04-11T20:00:00Z', '2026-04-11T20:30:00Z', 2.0),
      rate('2026-04-11T20:30:00Z', '2026-04-11T21:00:00Z', 1.0),
      rate('2026-04-11T21:00:00Z', '2026-04-11T21:30:00Z', -2.0),
      rate('2026-04-11T21:30:00Z', '2026-04-11T22:00:00Z', -3.0),
    ];
    const negWindows = findNegativePriceSlots(ramp, enabledSettings);
    const discharge = findPreDischargeSlots(ramp, negWindows, enabledSettings, {
      currentSoc: 25,
    });

    expect(discharge).toHaveLength(1);
    expect(discharge[0].slots).toHaveLength(2);
    // Should claim the two slots immediately before the negative window
    // (20:00 and 20:30), NOT the earliest (19:30).
    expect(discharge[0].slots.map((s) => s.valid_from)).toEqual([
      '2026-04-11T20:00:00Z',
      '2026-04-11T20:30:00Z',
    ]);
  });

  it('does not double-claim slots when two negative windows would walk into each other', () => {
    // window A: 02:00–02:30 (negative). Pre-slot 01:30 is positive.
    // window B: 03:00–03:30 (negative). Pre-slots 02:30 (negative — stops),
    // hmm — better: gap of two positive slots between A's end and B's start.
    //   01:30 +5  ← A's pre-slot
    //   02:00 -2  A
    //   02:30 +4  B walks back into here
    //   03:00 +3  B's first pre-slot (immediately before B)
    //   03:30 -1  B
    const interleaved: AgileRate[] = [
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', 5),
      rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -2),
      rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', 4),
      rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', 3),
      rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', -1),
    ];
    const negWindows = findNegativePriceSlots(interleaved, enabledSettings);
    expect(negWindows).toHaveLength(2);

    const discharge = findPreDischargeSlots(
      interleaved,
      negWindows,
      enabledSettings,
      { currentSoc: 100 },
    );

    // Window A (start 02:00) walks back: 01:30 ✓ (positive). Stops at start.
    // Window B (start 03:30) walks back: 03:00 ✓, 02:30 ✓, then hits the
    // negative slot at 02:00 and stops. Three discharge slots total, two
    // separate windows after merging (01:30 isolated, 02:30+03:00 adjacent).
    const allClaimed = discharge.flatMap((w) => w.slots.map((s) => s.valid_from));
    expect(allClaimed.sort()).toEqual([
      '2026-04-01T01:30:00Z',
      '2026-04-01T02:30:00Z',
      '2026-04-01T03:00:00Z',
    ]);
    // No duplicates
    expect(new Set(allClaimed).size).toBe(allClaimed.length);
  });

  it('respects the per-window refill capacity even when many positive slots precede', () => {
    // Single 30-min negative slot can only refill ~7 pre-discharge slots
    // (1.8 kWh charge / 0.25 kWh drain). Provide 10 positive slots before
    // and verify only 7 are claimed.
    const slotStamps = [
      ['2026-04-01T00:00:00Z', '2026-04-01T00:30:00Z'],
      ['2026-04-01T00:30:00Z', '2026-04-01T01:00:00Z'],
      ['2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z'],
      ['2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z'],
      ['2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z'],
      ['2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z'],
      ['2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z'],
      ['2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z'],
      ['2026-04-01T04:00:00Z', '2026-04-01T04:30:00Z'],
      ['2026-04-01T04:30:00Z', '2026-04-01T05:00:00Z'],
    ] as const;
    const positives = slotStamps.map(([from, to]) => rate(from, to, 5));
    const negSlot = rate(
      '2026-04-01T05:00:00Z',
      '2026-04-01T05:30:00Z',
      -2,
    );
    const allRates = [...positives, negSlot];

    const negWindows = findNegativePriceSlots(allRates, enabledSettings);
    const discharge = findPreDischargeSlots(allRates, negWindows, enabledSettings, {
      currentSoc: 100,
    });

    expect(discharge).toHaveLength(1);
    // refillSlotCap = floor(1 * 1.8 / 0.25) = 7
    expect(discharge[0].slots).toHaveLength(7);
    // Should be the 7 most recent positive slots (closest to the negative)
    expect(discharge[0].slots[0].valid_from).toBe('2026-04-01T01:30:00Z');
    expect(discharge[0].slots[6].valid_from).toBe('2026-04-01T04:30:00Z');
  });
});

describe('findAlwaysCheapSlots', () => {
  const cheapSettings = { ...baseSettings, always_charge_below_price: '5' } as AppSettings;

  it('returns empty when setting is 0 (disabled)', () => {
    const windows = findAlwaysCheapSlots(rates, baseSettings);
    expect(windows).toHaveLength(0);
  });

  it('finds slots below threshold, excludes negatives', () => {
    const windows = findAlwaysCheapSlots(rates, cheapSettings);
    const allSlots = windows.flatMap((w) => w.slots);
    // Only slot at 4p should match (positive and < 5)
    expect(allSlots).toHaveLength(1);
    expect(allSlots[0].price_inc_vat).toBe(4);
    // Negatives should NOT be included
    expect(allSlots.every((s) => s.price_inc_vat > 0)).toBe(true);
  });

  it('returns empty when no rates below threshold', () => {
    const expensiveRates = [
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', 10),
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', 15),
    ];
    const windows = findAlwaysCheapSlots(expensiveRates, cheapSettings);
    expect(windows).toHaveLength(0);
  });

  it('merges adjacent below-threshold slots', () => {
    const cheapRates = [
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', 3),
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', 2),
      rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', 10),
      rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', 1),
    ];
    const windows = findAlwaysCheapSlots(cheapRates, cheapSettings);
    // First two merge, third is too expensive, fourth is separate
    expect(windows).toHaveLength(2);
    expect(windows[0].slots).toHaveLength(2);
    expect(windows[1].slots).toHaveLength(1);
  });
});

describe('findNegativeRunDischargeSlots', () => {
  const fullSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    negative_price_charging: 'true',
    negative_run_discharge: 'true',
    battery_capacity_kwh: '5',
    max_charge_power_kw: '2.5',
    charge_rate: '100',
  };

  // slotsForFullCharge = ceil(5 / (2.5 * 0.5)) = ceil(4) = 4

  it('returns empty when disabled', () => {
    const windows = findNegativeRunDischargeSlots(rates, {
      ...fullSettings,
      negative_run_discharge: 'false',
    });
    expect(windows).toHaveLength(0);
  });

  it('returns empty when negative_price_charging is disabled', () => {
    const windows = findNegativeRunDischargeSlots(rates, {
      ...fullSettings,
      negative_price_charging: 'false',
    });
    expect(windows).toHaveLength(0);
  });

  it('returns empty when negative run is shorter than slotsForFullCharge', () => {
    // rates has runs of 2 and 1 negative slots, both shorter than 4
    const windows = findNegativeRunDischargeSlots(rates, fullSettings);
    expect(windows).toHaveLength(0);
  });

  it('returns leading discharge slots for a long negative run', () => {
    // Create a run of 6 negative slots — should discharge first 2, reserve last 4 for charging
    const longNegativeRates = [
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', -1),
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', -2),
      rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -3),
      rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', -4),
      rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', -5),
      rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', -6),
    ];
    const windows = findNegativeRunDischargeSlots(longNegativeRates, fullSettings);
    expect(windows).toHaveLength(1);
    expect(windows[0].type).toBe('discharge');
    // Should discharge first 2 slots (6 - 4 = 2)
    expect(windows[0].slots).toHaveLength(2);
    expect(windows[0].slots[0].valid_from).toBe('2026-04-01T01:00:00Z');
    expect(windows[0].slots[1].valid_from).toBe('2026-04-01T01:30:00Z');
  });

  it('handles multiple separate negative runs', () => {
    const multiRunRates = [
      // Short run (3 slots) — too short
      rate('2026-04-01T00:00:00Z', '2026-04-01T00:30:00Z', -1),
      rate('2026-04-01T00:30:00Z', '2026-04-01T01:00:00Z', -2),
      rate('2026-04-01T01:00:00Z', '2026-04-01T01:30:00Z', -3),
      // Gap
      rate('2026-04-01T01:30:00Z', '2026-04-01T02:00:00Z', 10),
      // Long run (6 slots) — should produce 2 discharge slots
      rate('2026-04-01T02:00:00Z', '2026-04-01T02:30:00Z', -1),
      rate('2026-04-01T02:30:00Z', '2026-04-01T03:00:00Z', -2),
      rate('2026-04-01T03:00:00Z', '2026-04-01T03:30:00Z', -3),
      rate('2026-04-01T03:30:00Z', '2026-04-01T04:00:00Z', -4),
      rate('2026-04-01T04:00:00Z', '2026-04-01T04:30:00Z', -5),
      rate('2026-04-01T04:30:00Z', '2026-04-01T05:00:00Z', -6),
    ];
    const windows = findNegativeRunDischargeSlots(multiRunRates, fullSettings);
    // Only the second (long) run should produce discharge
    expect(windows).toHaveLength(1);
    expect(windows[0].slots).toHaveLength(2);
    expect(windows[0].slots[0].valid_from).toBe('2026-04-01T02:00:00Z');
  });
});
