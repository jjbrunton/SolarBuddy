import { describe, expect, it } from 'vitest';
import { calculateCostForecast, formatCost } from '../forecast';

describe('calculateCostForecast', () => {
  const schedules = [
    { slot_start: '2026-04-03T01:00:00Z', slot_end: '2026-04-03T02:00:00Z' },
    { slot_start: '2026-04-03T00:00:00Z', slot_end: '2026-04-03T01:00:00Z' },
  ];

  const rates = [
    { valid_from: '2026-04-03T00:00:00Z', valid_to: '2026-04-03T00:30:00Z', price_inc_vat: 10 },
    { valid_from: '2026-04-03T00:30:00Z', valid_to: '2026-04-03T01:00:00Z', price_inc_vat: 20 },
    { valid_from: '2026-04-03T01:00:00Z', valid_to: '2026-04-03T01:30:00Z', price_inc_vat: 5 },
    { valid_from: '2026-04-03T01:30:00Z', valid_to: '2026-04-03T02:00:00Z', price_inc_vat: 50 },
  ];

  it('returns zero-cost windows when no charging is needed', () => {
    expect(calculateCostForecast(schedules, rates, 80, 80, 5.12, 3.6)).toEqual({
      total_energy_kwh: 0,
      total_cost_pence: 0,
      windows: [
        { slot_start: '2026-04-03T01:00:00Z', slot_end: '2026-04-03T02:00:00Z', energy_kwh: 0, cost_pence: 0 },
        { slot_start: '2026-04-03T00:00:00Z', slot_end: '2026-04-03T01:00:00Z', energy_kwh: 0, cost_pence: 0 },
      ],
    });
  });

  it('returns zero-cost windows when the battery or inverter configuration is invalid', () => {
    const result = calculateCostForecast(schedules, rates, 20, 80, 0, 3.6);

    expect(result.total_energy_kwh).toBe(0);
    expect(result.total_cost_pence).toBe(0);
    expect(result.windows).toHaveLength(2);
  });

  it('sorts schedules chronologically and stops once the target energy is met', () => {
    const result = calculateCostForecast(schedules, rates, 50, 80, 10, 2);

    expect(result).toEqual({
      total_energy_kwh: 3,
      total_cost_pence: 35,
      windows: [
        { slot_start: '2026-04-03T00:00:00Z', slot_end: '2026-04-03T01:00:00Z', energy_kwh: 2, cost_pence: 30 },
        { slot_start: '2026-04-03T01:00:00Z', slot_end: '2026-04-03T02:00:00Z', energy_kwh: 1, cost_pence: 5 },
      ],
    });
  });

  it('skips slots that have no matching tariff data', () => {
    const result = calculateCostForecast(
      [{ slot_start: '2026-04-03T00:00:00Z', slot_end: '2026-04-03T01:00:00Z' }],
      [{ valid_from: '2026-04-03T00:30:00Z', valid_to: '2026-04-03T01:00:00Z', price_inc_vat: 20 }],
      0,
      20,
      5,
      2,
    );

    expect(result).toEqual({
      total_energy_kwh: 1,
      total_cost_pence: 20,
      windows: [
        { slot_start: '2026-04-03T00:00:00Z', slot_end: '2026-04-03T01:00:00Z', energy_kwh: 1, cost_pence: 20 },
      ],
    });
  });
});

describe('formatCost', () => {
  it('formats sub-pound values in pence', () => {
    expect(formatCost(42.2)).toBe('42p');
  });

  it('formats larger values in pounds', () => {
    expect(formatCost(250)).toBe('£2.50');
  });
});
