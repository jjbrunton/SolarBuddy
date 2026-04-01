import { describe, expect, it } from 'vitest';
import { generateSyntheticRates } from '../rate-generator';
import { TARIFF_DEFINITIONS } from '../definitions';
import type { AppSettings } from '../../config';

const baseSettings = {
  tariff_offpeak_rate: '7.5',
  tariff_peak_rate: '35',
  tariff_standard_rate: '24.5',
} as AppSettings;

describe('generateSyntheticRates', () => {
  it('generates 30-minute slots for Go tariff', () => {
    const tariff = TARIFF_DEFINITIONS.go;
    const from = '2026-04-01T00:00:00Z';
    const to = '2026-04-02T00:00:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);

    // 24 hours * 2 slots/hour = 48 slots
    expect(rates).toHaveLength(48);
    expect(rates[0].valid_from).toBe('2026-04-01T00:00:00.000Z');
    expect(rates[0].valid_to).toBe('2026-04-01T00:30:00.000Z');
    expect(rates[47].valid_to).toBe('2026-04-02T00:00:00.000Z');
  });

  it('applies correct Go off-peak rate (00:30-05:30 BST = 23:30-04:30 UTC in summer)', () => {
    const tariff = TARIFF_DEFINITIONS.go;
    // In BST (April), 00:30 local = 23:30 UTC previous day
    // Use a slot that's clearly in the Go off-peak window
    const from = '2026-04-01T00:00:00Z'; // 01:00 BST — in Go off-peak
    const to = '2026-04-01T00:30:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);
    expect(rates).toHaveLength(1);
    // 01:00 BST is within Go off-peak (00:30-05:30 local)
    expect(rates[0].price_inc_vat).toBe(7.5);
  });

  it('applies standard rate outside off-peak for Go', () => {
    const tariff = TARIFF_DEFINITIONS.go;
    // 12:00 UTC = 13:00 BST — standard time
    const from = '2026-04-01T12:00:00Z';
    const to = '2026-04-01T12:30:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);
    expect(rates).toHaveLength(1);
    expect(rates[0].price_inc_vat).toBe(24.5);
  });

  it('generates Flux rates with three bands', () => {
    const tariff = TARIFF_DEFINITIONS.flux;
    const from = '2026-04-01T00:00:00Z';
    const to = '2026-04-02T00:00:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);
    expect(rates).toHaveLength(48);

    const prices = new Set(rates.map((r) => r.price_inc_vat));
    // Should have at least off-peak (7.5), peak (35), and standard (24.5)
    expect(prices.has(7.5)).toBe(true);
    expect(prices.has(35)).toBe(true);
    expect(prices.has(24.5)).toBe(true);
  });

  it('generates Cosy rates with two cheap periods', () => {
    const tariff = TARIFF_DEFINITIONS.cosy;
    const from = '2026-04-01T00:00:00Z';
    const to = '2026-04-02T00:00:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);
    expect(rates).toHaveLength(48);

    // Cosy cheap periods: 04:00-07:00 and 13:00-16:00 local
    // In BST: 03:00-06:00 and 12:00-15:00 UTC
    const cheapSlots = rates.filter((r) => r.price_inc_vat === 7.5);
    // 3 hours * 2 slots + 3 hours * 2 slots = 12 cheap slots
    expect(cheapSlots.length).toBe(12);
  });

  it('does not generate rates for Agile (uses API)', () => {
    const tariff = TARIFF_DEFINITIONS.agile;
    expect(tariff.usesApiRates).toBe(true);
    expect(tariff.bands).toHaveLength(0);
  });

  it('applies VAT correctly', () => {
    const tariff = TARIFF_DEFINITIONS.go;
    const from = '2026-04-01T12:00:00Z';
    const to = '2026-04-01T12:30:00Z';
    const rates = generateSyntheticRates(tariff, baseSettings, from, to);
    // 5% VAT on electricity
    expect(rates[0].price_exc_vat).toBeCloseTo(24.5 / 1.05, 5);
  });
});
