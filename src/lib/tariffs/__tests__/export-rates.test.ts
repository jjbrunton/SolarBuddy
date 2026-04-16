import { describe, expect, it } from 'vitest';
import { generateSyntheticExportRates } from '../rate-generator';
import { getTariffDefinition, TARIFF_DEFINITIONS } from '../definitions';

describe('generateSyntheticExportRates', () => {
  it('generates one slot per 30 minutes at the fixed rate', () => {
    const rates = generateSyntheticExportRates(15, '2026-04-01T00:00:00Z', '2026-04-01T02:00:00Z');
    expect(rates).toHaveLength(4);
    for (const r of rates) {
      expect(r.price_inc_vat).toBe(15);
      expect(r.price_exc_vat).toBeCloseTo(15 / 1.05, 5);
    }
    expect(rates[0].valid_from).toBe('2026-04-01T00:00:00.000Z');
    expect(rates[0].valid_to).toBe('2026-04-01T00:30:00.000Z');
    expect(rates[3].valid_to).toBe('2026-04-01T02:00:00.000Z');
  });

  it('aligns start time down to the nearest 30-minute boundary', () => {
    const rates = generateSyntheticExportRates(5, '2026-04-01T00:10:00Z', '2026-04-01T01:00:00Z');
    expect(rates[0].valid_from).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles zero-rate (no export tariff) correctly', () => {
    const rates = generateSyntheticExportRates(0, '2026-04-01T00:00:00Z', '2026-04-01T00:30:00Z');
    expect(rates).toHaveLength(1);
    expect(rates[0].price_inc_vat).toBe(0);
    expect(rates[0].price_exc_vat).toBe(0);
  });

  it('returns empty when the window is empty', () => {
    const rates = generateSyntheticExportRates(12, '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');
    expect(rates).toEqual([]);
  });
});

describe('getTariffDefinition', () => {
  it('returns the definition for a known type', () => {
    expect(getTariffDefinition('go')).toBe(TARIFF_DEFINITIONS.go);
    expect(getTariffDefinition('flux')).toBe(TARIFF_DEFINITIONS.flux);
  });

  it('falls back to agile for unknown types', () => {
    expect(getTariffDefinition('mystery')).toBe(TARIFF_DEFINITIONS.agile);
    expect(getTariffDefinition('')).toBe(TARIFF_DEFINITIONS.agile);
  });
});
