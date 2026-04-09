import { describe, expect, it } from 'vitest';
import { convertToAgileRates, parseHour, type ConversionParams } from '../converter';
import type { NordpoolSlot } from '../client';

const DEFAULT_PARAMS: ConversionParams = {
  distributionMultiplier: 2.2,
  peakAdder: 12.5,
  peakStartHour: 16,
  peakEndHour: 19,
};

function makeSlot(hour: number, pricePkwh: number): NordpoolSlot {
  // Use a winter date (GMT, no BST offset) for predictable UK hours.
  const start = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:00:00.000Z`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    valid_from: start.toISOString(),
    valid_to: end.toISOString(),
    wholesale_price_pkwh: pricePkwh,
  };
}

describe('convertToAgileRates', () => {
  it('converts an off-peak slot correctly', () => {
    // 10:00 GMT = 10:00 UK (winter), not peak
    const slots = [makeSlot(10, 5)]; // 5 p/kWh wholesale
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    expect(rates).toHaveLength(1);
    // price_exc_vat = min(2.2 * 5 + 0, 95) = 11
    // price_inc_vat = 11 * 1.05 = 11.55
    expect(rates[0].price_exc_vat).toBe(11);
    expect(rates[0].price_inc_vat).toBe(11.55);
    expect(rates[0].source).toBe('nordpool');
  });

  it('applies peak adder during peak hours', () => {
    // 17:00 GMT = 17:00 UK (winter), peak period
    const slots = [makeSlot(17, 5)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    // price_exc_vat = min(2.2 * 5 + 12.5, 95) = 23.5
    // price_inc_vat = 23.5 * 1.05 = 24.675 → 24.68
    expect(rates[0].price_exc_vat).toBe(23.5);
    expect(rates[0].price_inc_vat).toBe(24.68);
  });

  it('does not apply peak adder at boundary hour (16:00 is peak)', () => {
    const slots = [makeSlot(16, 5)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);
    // 16:00 is >= peakStartHour (16) and < peakEndHour (19) → peak
    expect(rates[0].price_exc_vat).toBe(23.5);
  });

  it('does not apply peak adder at end boundary (19:00 is not peak)', () => {
    const slots = [makeSlot(19, 5)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);
    // 19:00 is not < peakEndHour (19) → off-peak
    expect(rates[0].price_exc_vat).toBe(11);
  });

  it('caps at 95 p/kWh pre-VAT', () => {
    // Very high wholesale price
    const slots = [makeSlot(10, 50)]; // 2.2 * 50 = 110 → capped to 95
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    expect(rates[0].price_exc_vat).toBe(95);
    expect(rates[0].price_inc_vat).toBe(99.75); // 95 * 1.05
  });

  it('handles negative wholesale prices', () => {
    const slots = [makeSlot(3, -2)]; // -2 p/kWh wholesale
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    // price_exc_vat = min(2.2 * -2 + 0, 95) = min(-4.4, 95) = -4.4
    // price_inc_vat = -4.4 * 1.05 = -4.62
    expect(rates[0].price_exc_vat).toBe(-4.4);
    expect(rates[0].price_inc_vat).toBe(-4.62);
  });

  it('handles zero wholesale price', () => {
    const slots = [makeSlot(10, 0)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    expect(rates[0].price_exc_vat).toBe(0);
    expect(rates[0].price_inc_vat).toBe(0);
  });

  it('preserves valid_from and valid_to from input slots', () => {
    const slots = [makeSlot(10, 5)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);

    expect(rates[0].valid_from).toBe(slots[0].valid_from);
    expect(rates[0].valid_to).toBe(slots[0].valid_to);
  });

  it('converts multiple slots', () => {
    const slots = [makeSlot(2, 3), makeSlot(17, 10), makeSlot(22, 8)];
    const rates = convertToAgileRates(slots, DEFAULT_PARAMS);
    expect(rates).toHaveLength(3);
  });

  it('respects custom distribution multiplier', () => {
    const slots = [makeSlot(10, 10)];
    const params = { ...DEFAULT_PARAMS, distributionMultiplier: 2.0 };
    const rates = convertToAgileRates(slots, params);

    // 2.0 * 10 = 20
    expect(rates[0].price_exc_vat).toBe(20);
  });

  it('returns empty array for empty input', () => {
    expect(convertToAgileRates([], DEFAULT_PARAMS)).toEqual([]);
  });
});

describe('parseHour', () => {
  it('parses HH:MM to hour', () => {
    expect(parseHour('16:00')).toBe(16);
    expect(parseHour('07:30')).toBe(7);
    expect(parseHour('00:00')).toBe(0);
    expect(parseHour('23:59')).toBe(23);
  });
});
