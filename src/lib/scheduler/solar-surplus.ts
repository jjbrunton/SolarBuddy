import type { InverterState } from '../types';

const POWER_TOLERANCE_W = 50;
const HALF_HOUR_HOURS = 0.5;

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

/** Forecast age past which we refuse to trust P10 for the trajectory guard. */
export const FORECAST_STALENESS_MINUTES = 12 * 60;

export interface PessimisticSolarParams {
  currentSoc: number | null;
  targetSoc: number;
  batteryCapacityKwh: number;
  /** Contiguous `charge` plan slots starting with the currently-active one. */
  remainingSlots: { slot_start: string; slot_end: string }[];
  /** Stored PV forecast rows covering the remaining slot window. */
  forecast: { valid_from: string; pv_estimate10_w: number }[];
  /** Age in minutes of the most recent forecast fetch, or Infinity if none. */
  forecastAgeMinutes: number;
  /** Expected consumption in W at the given slot start (learned usage profile). */
  expectedLoadAtW: (slotStart: string) => number;
  /** Optional damp factor applied to the P10 value. Defaults to 1. */
  dampFactor?: number;
}

/**
 * Trajectory guard for the solar-surplus hold. Returns true only when the
 * pessimistic (P10) PV forecast across the remaining contiguous cheap-charge
 * slots is sufficient to bring SOC from its current value up to `targetSoc`.
 *
 * Conservative by design:
 *   - Unknown SOC → false (prefer grid charge).
 *   - No remaining slots → false (single current slot can't be relied on alone
 *     because the hold would apply every tick; if we can't back-check future
 *     slots, charge now).
 *   - Missing or stale forecast → false.
 *
 * Using P10 rather than instantaneous PV solves two failure modes at once: a
 * transient cloud dip doesn't trigger an unnecessary grid charge, and an
 * over-optimistic mean forecast doesn't silently sandbag SOC when the sky
 * turns out cloudier than expected.
 */
export function canReachTargetWithPessimisticSolar(params: PessimisticSolarParams): boolean {
  if (params.currentSoc === null) return false;
  if (params.currentSoc >= params.targetSoc) return true;
  if (params.remainingSlots.length === 0) return false;
  if (params.forecast.length === 0) return false;
  if (!Number.isFinite(params.forecastAgeMinutes)) return false;
  if (params.forecastAgeMinutes > FORECAST_STALENESS_MINUTES) return false;

  const deficitKwh = ((params.targetSoc - params.currentSoc) / 100) * params.batteryCapacityKwh;
  if (deficitKwh <= 0) return true;

  const damp = params.dampFactor ?? 1;
  const forecastBySlot = new Map(
    params.forecast.map((row) => [row.valid_from, row.pv_estimate10_w]),
  );

  let availableKwh = 0;
  for (const slot of params.remainingSlots) {
    const pvW = forecastBySlot.get(slot.slot_start);
    if (pvW === undefined) continue;
    const loadW = params.expectedLoadAtW(slot.slot_start);
    const netW = Math.max(0, pvW * damp - loadW);
    availableKwh += (netW * HALF_HOUR_HOURS) / 1000;
  }

  return availableKwh >= deficitKwh;
}
