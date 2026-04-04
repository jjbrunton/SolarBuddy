import { describe, expect, it } from 'vitest';
import { detectPeakPeriod, findPeakPrepSlots } from '../peak';
import type { AgileRate } from '../../octopus/rates';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';

const baseSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  octopus_region: 'H',
  peak_protection: 'true',
};

function rate(valid_from: string, valid_to: string, price: number): AgileRate {
  return { valid_from, valid_to, price_inc_vat: price, price_exc_vat: price };
}

// Simulate an afternoon with slots from 12:00 to 20:00 UTC (13:00-21:00 BST)
// Peak is 16:00-19:00 local (BST), which in summer is 15:00-18:00 UTC
const afternoonRates: AgileRate[] = [
  rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 10),
  rate('2026-04-01T11:30:00Z', '2026-04-01T12:00:00Z', 8),
  rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', 15),
  rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', 12),
  rate('2026-04-01T13:00:00Z', '2026-04-01T13:30:00Z', 20),
  rate('2026-04-01T13:30:00Z', '2026-04-01T14:00:00Z', 25),
  rate('2026-04-01T14:00:00Z', '2026-04-01T14:30:00Z', 5),  // cheapest pre-peak
  rate('2026-04-01T14:30:00Z', '2026-04-01T15:00:00Z', 35), // peak start (16:00 BST)
  rate('2026-04-01T15:00:00Z', '2026-04-01T15:30:00Z', 40), // peak
  rate('2026-04-01T15:30:00Z', '2026-04-01T16:00:00Z', 45), // peak
  rate('2026-04-01T16:00:00Z', '2026-04-01T16:30:00Z', 50), // peak
  rate('2026-04-01T16:30:00Z', '2026-04-01T17:00:00Z', 42), // peak
  rate('2026-04-01T17:00:00Z', '2026-04-01T17:30:00Z', 38), // peak end (19:00 BST)
  rate('2026-04-01T17:30:00Z', '2026-04-01T18:00:00Z', 18), // after peak
];

describe('findPeakPrepSlots', () => {
  it('returns empty when peak protection is disabled', () => {
    const windows = findPeakPrepSlots(afternoonRates, {
      ...baseSettings,
      peak_protection: 'false',
    }, { currentSoc: 50, now: new Date('2026-04-01T10:00:00Z') });
    expect(windows).toHaveLength(0);
  });

  it('returns empty when SOC already meets peak target', () => {
    const windows = findPeakPrepSlots(afternoonRates, baseSettings, {
      currentSoc: 95,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    expect(windows).toHaveLength(0);
  });

  it('selects cheapest pre-peak slots', () => {
    const windows = findPeakPrepSlots(afternoonRates, baseSettings, {
      currentSoc: 50,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    expect(windows.length).toBeGreaterThan(0);
    // The cheapest pre-peak slot is at 14:00 UTC (5p)
    const allSlots = windows.flatMap((w) => w.slots);
    expect(allSlots.some((s) => s.valid_from === '2026-04-01T14:00:00Z')).toBe(true);
  });

  it('does not include peak period slots', () => {
    const windows = findPeakPrepSlots(afternoonRates, baseSettings, {
      currentSoc: 50,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    const allSlots = windows.flatMap((w) => w.slots);
    // None of the selected slots should be during peak (14:30-17:30 UTC in BST)
    for (const slot of allSlots) {
      expect(slot.valid_from < '2026-04-01T14:30:00Z' || slot.valid_from >= '2026-04-01T17:30:00Z').toBe(true);
    }
  });

  it('respects price threshold', () => {
    const windows = findPeakPrepSlots(afternoonRates, {
      ...baseSettings,
      price_threshold: '12',
    }, {
      currentSoc: 50,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    const allSlots = windows.flatMap((w) => w.slots);
    for (const slot of allSlots) {
      expect(slot.price_inc_vat).toBeLessThanOrEqual(12);
    }
  });

  it('returns empty when no current SOC available', () => {
    const windows = findPeakPrepSlots(afternoonRates, baseSettings, {
      currentSoc: null,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    expect(windows).toHaveLength(0);
  });

  it('uses auto-detected peak when peak_detection is auto', () => {
    const windows = findPeakPrepSlots(afternoonRates, {
      ...baseSettings,
      peak_detection: 'auto',
      peak_duration_slots: '3',
    }, {
      currentSoc: 50,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    // Auto-detect should find the 3-slot window with highest total cost
    // That's 15:30-17:00 UTC (45+50+42=137)
    // Pre-peak slots should be before that window
    expect(windows.length).toBeGreaterThan(0);
    const allSlots = windows.flatMap((w) => w.slots);
    for (const slot of allSlots) {
      expect(slot.valid_from < '2026-04-01T15:30:00Z').toBe(true);
    }
  });
});

describe('detectPeakPeriod', () => {
  const now = new Date('2026-04-01T10:00:00Z');

  it('finds the highest-cost contiguous block', () => {
    const result = detectPeakPeriod(afternoonRates, 3, now);
    expect(result).not.toBeNull();
    // The 3-slot window with highest cost: 15:30-17:00 (45+50+42=137)
    expect(result!.peakStart).toBe('2026-04-01T15:30:00Z');
    expect(result!.peakEnd).toBe('2026-04-01T17:00:00Z');
  });

  it('returns null when fewer rates than durationSlots', () => {
    const shortRates = [
      rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 10),
    ];
    expect(detectPeakPeriod(shortRates, 3, now)).toBeNull();
  });

  it('handles single-slot duration', () => {
    const result = detectPeakPeriod(afternoonRates, 1, now);
    expect(result).not.toBeNull();
    // Most expensive single slot is 50p at 16:00
    expect(result!.peakStart).toBe('2026-04-01T16:00:00Z');
  });

  it('uses earliest window on ties', () => {
    const tiedRates = [
      rate('2026-04-01T11:00:00Z', '2026-04-01T11:30:00Z', 20),
      rate('2026-04-01T11:30:00Z', '2026-04-01T12:00:00Z', 20),
      rate('2026-04-01T12:00:00Z', '2026-04-01T12:30:00Z', 20),
      rate('2026-04-01T12:30:00Z', '2026-04-01T13:00:00Z', 20),
    ];
    const result = detectPeakPeriod(tiedRates, 2, now);
    // All pairs have the same cost, should pick the first
    expect(result!.peakStart).toBe('2026-04-01T11:00:00Z');
  });
});
