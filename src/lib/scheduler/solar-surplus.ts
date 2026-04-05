import type { InverterState } from '../types';

const POWER_TOLERANCE_W = 50;

/**
 * True when the site is either exporting to the grid, charging the battery
 * without importing, or visibly generating enough PV to cover the load. The
 * watchdog uses this to decide whether an opportunistic top-up slot should
 * hold instead of force-charging from the grid.
 */
export function shouldHoldForSolarSurplus(
  state: Pick<InverterState, 'pv_power' | 'load_power' | 'grid_power' | 'battery_power'>,
): boolean {
  const exportingToGrid = state.grid_power !== null && state.grid_power < -POWER_TOLERANCE_W;
  const batteryChargingWithoutImport =
    state.battery_power !== null &&
    state.battery_power > POWER_TOLERANCE_W &&
    (state.grid_power === null || state.grid_power <= POWER_TOLERANCE_W);
  const pvAppearsToCoverLoad =
    state.pv_power !== null &&
    state.load_power !== null &&
    state.pv_power >= state.load_power + POWER_TOLERANCE_W;

  return exportingToGrid || batteryChargingWithoutImport || pvAppearsToCoverLoad;
}
