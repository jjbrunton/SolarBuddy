import type { AppSettings } from '../config';
import type { InverterState } from '../types';
import { appendEvent } from '../events';
import {
  clearExpiredAutoOverrides,
  getCurrentAutoOverride,
  insertAutoOverride,
  type AutoOverrideRow,
} from '../db/auto-override-repository';

const SLOT_DURATION_MS = 30 * 60 * 1000;

export interface AutoOverrideDecision {
  applied: boolean;
  override?: AutoOverrideRow;
  cleared?: number;
}

/**
 * Returns the inclusive start and exclusive end of the 30-minute slot
 * containing `now`, both as ISO strings.
 */
function slotBoundariesFor(now: Date): { slotStart: string; slotEnd: string } {
  const start = new Date(now.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30);
  const end = new Date(start.getTime() + SLOT_DURATION_MS);
  return { slotStart: start.toISOString(), slotEnd: end.toISOString() };
}

function parseIntSetting(value: string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Evaluates whether a short-lived auto-override should be inserted based on
 * the current SOC and settings. Designed to run every 5 minutes from a cron
 * job without rebuilding the full plan. Errors are swallowed and logged so
 * the cron can never crash the app.
 *
 * The check order is sequential, first match wins:
 *   1. Expired entries are cleaned up first.
 *   2. If an override already exists for the current slot, no-op.
 *   3. SOC below `always_charge_below_soc` → insert charge override.
 *   4. SOC at or below `discharge_soc_floor` → insert hold override (battery
 *      exhausted guard — prevents a resolver-level discharge draining the
 *      battery below the user's floor).
 */
export function evaluateAutoOverrides(
  now: Date,
  state: Pick<InverterState, 'battery_soc'>,
  settings: AppSettings,
): AutoOverrideDecision {
  try {
    const nowIso = now.toISOString();
    const cleared = clearExpiredAutoOverrides(nowIso);

    const { slotStart, slotEnd } = slotBoundariesFor(now);

    const existing = getCurrentAutoOverride(nowIso);
    if (existing) {
      return { applied: false, cleared };
    }

    const soc = state.battery_soc;
    if (soc === null || soc === undefined || !Number.isFinite(soc)) {
      return { applied: false, cleared };
    }

    // Tier 1: always-charge-below-SOC boost.
    const alwaysChargeBelow = parseIntSetting(settings.always_charge_below_soc);
    if (alwaysChargeBelow !== null && soc < alwaysChargeBelow) {
      const row: AutoOverrideRow = {
        slot_start: slotStart,
        slot_end: slotEnd,
        action: 'charge',
        source: 'soc_boost',
        reason: `SOC ${soc}% below always-charge threshold ${alwaysChargeBelow}%`,
        expires_at: slotEnd,
      };
      insertAutoOverride(row);
      return { applied: true, override: row, cleared };
    }

    // Tier 2: battery exhausted guard — prevent a scheduled discharge from
    // taking the battery below the user's configured floor. We cannot call the
    // resolver here (circular dep), so we fire whenever SOC is at or below the
    // floor. The resolver will then see the hold override and honour it.
    const dischargeFloor = parseIntSetting(settings.discharge_soc_floor);
    if (dischargeFloor !== null && soc <= dischargeFloor) {
      const row: AutoOverrideRow = {
        slot_start: slotStart,
        slot_end: slotEnd,
        action: 'hold',
        source: 'battery_exhausted_guard',
        reason: `SOC ${soc}% at or below discharge floor ${dischargeFloor}%`,
        expires_at: slotEnd,
      };
      insertAutoOverride(row);
      return { applied: true, override: row, cleared };
    }

    return { applied: false, cleared };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      appendEvent({
        level: 'error',
        category: 'auto-override',
        message: `Auto-override evaluation failed: ${message}`,
      });
    } catch {
      // Never re-throw from the 5-minute cron path.
    }
    return { applied: false };
  }
}
