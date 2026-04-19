import { describe, expect, it } from 'vitest';
import { aggregateReadingsBySlot, halfHourStartISO } from '../slot-aggregation';

describe('halfHourStartISO', () => {
  it('floors to the nearest half hour', () => {
    expect(halfHourStartISO('2026-04-10T12:15:30Z')).toBe('2026-04-10T12:00:00.000Z');
    expect(halfHourStartISO('2026-04-10T12:45:00Z')).toBe('2026-04-10T12:30:00.000Z');
    expect(halfHourStartISO('2026-04-10T12:30:00Z')).toBe('2026-04-10T12:30:00.000Z');
  });
});

describe('aggregateReadingsBySlot', () => {
  it('buckets readings into half-hour slots and converts mean power to kWh', () => {
    const samples = [
      { timestamp: '2026-04-10T12:00:00Z', load_power: 1000, pv_power: 0, grid_power: 1000, battery_soc: 50 },
      { timestamp: '2026-04-10T12:15:00Z', load_power: 2000, pv_power: 0, grid_power: 2000, battery_soc: 48 },
      { timestamp: '2026-04-10T12:29:00Z', load_power: 3000, pv_power: 0, grid_power: 3000, battery_soc: 46 },
      { timestamp: '2026-04-10T12:30:00Z', load_power: 500, pv_power: 500, grid_power: 0, battery_soc: 46 },
    ];
    const slots = aggregateReadingsBySlot(samples);
    expect(slots).toHaveLength(2);
    // Mean load over first slot = (1000+2000+3000)/3 = 2000 W → 1 kWh over 0.5h
    expect(slots[0].slot_start).toBe('2026-04-10T12:00:00.000Z');
    expect(slots[0].load_kwh).toBeCloseTo(1, 5);
    expect(slots[0].pv_kwh).toBeCloseTo(0, 5);
    expect(slots[0].grid_import_kwh).toBeCloseTo(1, 5);
    expect(slots[0].grid_export_kwh).toBe(0);
    expect(slots[0].starting_soc).toBe(50);
    expect(slots[1].slot_start).toBe('2026-04-10T12:30:00.000Z');
    expect(slots[1].load_kwh).toBeCloseTo(0.25, 5);
    expect(slots[1].pv_kwh).toBeCloseTo(0.25, 5);
  });

  it('splits grid_power into import vs export by sign', () => {
    const samples = [
      { timestamp: '2026-04-10T12:00:00Z', load_power: 0, pv_power: 4000, grid_power: -2000, battery_soc: 80 },
      { timestamp: '2026-04-10T12:15:00Z', load_power: 0, pv_power: 4000, grid_power: -2000, battery_soc: 80 },
    ];
    const slots = aggregateReadingsBySlot(samples);
    expect(slots[0].grid_import_kwh).toBe(0);
    expect(slots[0].grid_export_kwh).toBeCloseTo(1, 5);
  });

  it('returns empty for empty input', () => {
    expect(aggregateReadingsBySlot([])).toEqual([]);
  });

  it('ignores null power fields gracefully', () => {
    const samples = [
      { timestamp: '2026-04-10T12:00:00Z', load_power: null, pv_power: 2000, grid_power: null, battery_soc: null },
    ];
    const slots = aggregateReadingsBySlot(samples);
    expect(slots).toHaveLength(1);
    expect(slots[0].load_kwh).toBe(0);
    expect(slots[0].pv_kwh).toBeCloseTo(1, 5);
    expect(slots[0].starting_soc).toBeNull();
  });
});
