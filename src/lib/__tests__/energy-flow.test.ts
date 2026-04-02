import { describe, expect, it } from 'vitest';
import { buildEnergyFlows } from '../energy-flow';

describe('buildEnergyFlows', () => {
  it('routes grid import separately to home load and battery charging', () => {
    expect(
      buildEnergyFlows({
        pv_power: 0,
        grid_power: 4100,
        battery_power: 3000,
        load_power: 1100,
      }),
    ).toEqual([
      { pathKey: 'grid_battery', power: 3000 },
      { pathKey: 'grid_home', power: 1100 },
    ]);
  });

  it('uses solar first and only tops the battery up from grid for the remainder', () => {
    expect(
      buildEnergyFlows({
        pv_power: 3500,
        grid_power: 500,
        battery_power: 3000,
        load_power: 1000,
      }),
    ).toEqual([
      { pathKey: 'solar_home', power: 1000 },
      { pathKey: 'solar_battery', power: 2500 },
      { pathKey: 'grid_battery', power: 500 },
    ]);
  });

  it('shows battery discharge to home and export separately', () => {
    expect(
      buildEnergyFlows({
        pv_power: 0,
        grid_power: -500,
        battery_power: -1000,
        load_power: 500,
      }),
    ).toEqual([
      { pathKey: 'battery_home', power: 500 },
      { pathKey: 'home_grid', power: 500 },
    ]);
  });
});
