import { describe, expect, it } from 'vitest';
import { shouldHoldForSolarSurplus } from '../solar-surplus';

describe('shouldHoldForSolarSurplus', () => {
  it('returns true when the site is exporting or charging without importing', () => {
    expect(
      shouldHoldForSolarSurplus({
        pv_power: 1400,
        load_power: 500,
        grid_power: -200,
        battery_power: 100,
      }),
    ).toBe(true);
  });

  it('returns false when the battery needs grid support', () => {
    expect(
      shouldHoldForSolarSurplus({
        pv_power: 200,
        load_power: 900,
        grid_power: 700,
        battery_power: 0,
      }),
    ).toBe(false);
  });
});
