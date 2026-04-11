import type { AppSettings } from '../config';
import { getDb } from '../db';
import { getCurrentAutoOverride } from '../db/auto-override-repository';
import type { PlanAction } from '../plan-actions';
import { evaluateScheduledActions } from '../scheduled-actions';
import type { InverterState } from '../types';
import {
  getVirtualCurrentPlanSlot,
  getVirtualScheduleData,
  isVirtualModeEnabled,
} from '../virtual-inverter/runtime';
import { getChargingStrategy } from './engine';
import { shouldHoldForSolarSurplus } from './solar-surplus';

const UPCOMING_PLAN_SLOT_LIMIT = 48;

export type SlotActionSource =
  | 'manual'
  | 'auto'
  | 'scheduled'
  | 'plan'
  | 'target_soc'
  | 'solar_surplus'
  | 'default';

export interface ResolvedSlotAction {
  action: PlanAction;
  source: SlotActionSource;
  reason: string;
  detail: string;
  slotStart?: string;
  slotEnd?: string;
}

export interface ResolvedSlotRange extends ResolvedSlotAction {
  /** Inclusive — `slot_start` of the first slot in the run. */
  rangeStart: string;
  /** Exclusive — `slot_end` of the last slot in the run. */
  rangeEnd: string;
  /** Number of contiguous same-action plan slots conflated into this run. */
  slotsInRange: number;
}

interface OverrideRow {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
}

interface PlanSlotRow {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string | null;
}

export function getCurrentOverride(nowIso: string): OverrideRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT slot_start, slot_end, action
         FROM manual_overrides
         WHERE slot_start <= ? AND slot_end > ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(nowIso, nowIso) as OverrideRow | undefined) ?? null
  );
}

export function getCurrentPlanSlot(nowIso: string): PlanSlotRow | null {
  if (isVirtualModeEnabled()) {
    return getVirtualCurrentPlanSlot(nowIso);
  }

  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT slot_start, slot_end, action, reason
         FROM plan_slots
         WHERE slot_start <= ? AND slot_end > ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(nowIso, nowIso) as PlanSlotRow | undefined) ?? null
  );
}

/**
 * Returns the sequence of plan slots whose `slot_end` is strictly after `nowIso`,
 * ordered ascending by `slot_start`. The first entry is the slot that is
 * currently active (if any); subsequent entries are future slots.
 *
 * The limit keeps the walk bounded even if the plan table grows unexpectedly;
 * 48 is comfortably larger than any contiguous same-action run we expect in
 * practice (a 48 * 30-minute slot run covers a full day).
 */
export function getUpcomingPlanSlots(nowIso: string): PlanSlotRow[] {
  if (isVirtualModeEnabled()) {
    const { plan_slots } = getVirtualScheduleData(new Date(nowIso));
    return plan_slots
      .filter((slot) => slot.slot_end > nowIso)
      .sort((a, b) => (a.slot_start < b.slot_start ? -1 : a.slot_start > b.slot_start ? 1 : 0))
      .slice(0, UPCOMING_PLAN_SLOT_LIMIT)
      .map((slot) => ({
        slot_start: slot.slot_start,
        slot_end: slot.slot_end,
        action: slot.action as PlanAction,
        reason: slot.reason ?? null,
      }));
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT slot_start, slot_end, action, reason
       FROM plan_slots
       WHERE slot_end > ?
       ORDER BY slot_start ASC
       LIMIT ?`,
    )
    .all(nowIso, UPCOMING_PLAN_SLOT_LIMIT) as PlanSlotRow[] | undefined;

  return rows ?? [];
}

/**
 * Resolves the slot action the scheduler intends to apply right now by
 * walking the standard priority cascade: manual override, scheduled action,
 * active plan slot (with target-SOC / solar-surplus holds), default hold.
 *
 * This is the single source of truth for "what should the inverter be doing
 * right now" and should be used by both the watchdog and any UI path that
 * surfaces the current scheduler intent.
 */
export function resolveSlotAction(
  now: Date,
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'>,
  settings: AppSettings,
): ResolvedSlotAction {
  const nowIso = now.toISOString();
  const override = getCurrentOverride(nowIso);
  if (override) {
    return {
      action: override.action,
      source: 'manual',
      reason: 'manual_override',
      detail: `Manual override ${override.action} is active for the current slot.`,
      slotStart: override.slot_start,
      slotEnd: override.slot_end,
    };
  }

  // Auto overrides — short-lived corrections inserted by the 5-minute tick
  // (SOC boosts, battery-exhausted guards). Sit between manual_overrides and
  // scheduled_actions so user-driven manual overrides always win.
  const autoOverride = getCurrentAutoOverride(nowIso);
  if (autoOverride) {
    return {
      action: autoOverride.action,
      source: 'auto',
      reason: `auto_override:${autoOverride.source}`,
      detail: autoOverride.reason,
      slotStart: autoOverride.slot_start,
      slotEnd: autoOverride.slot_end,
    };
  }

  // Scheduled actions (user-defined time + SOC rules) take priority over plan slots
  const scheduled = evaluateScheduledActions(now, state.battery_soc);
  if (scheduled) {
    return {
      action: scheduled.action,
      source: 'scheduled',
      reason: 'scheduled_action',
      detail: scheduled.reason,
    };
  }

  const plannedSlot = getCurrentPlanSlot(nowIso);
  if (!plannedSlot) {
    return {
      action: 'hold',
      source: 'default',
      reason: 'default_mode',
      detail: 'No active override or schedule window applies right now. Holding battery at current SOC.',
    };
  }

  const scheduleAction = plannedSlot.action;
  if (scheduleAction === 'charge') {
    const minSoc = parseInt(settings.min_soc_target, 10) || 80;

    if (state.battery_soc !== null && state.battery_soc >= minSoc) {
      return {
        action: 'hold',
        source: 'target_soc',
        reason: 'target_soc_reached',
        detail: `Scheduled charge window is active, but battery SOC is already at or above ${minSoc}%. Holding.`,
        slotStart: plannedSlot.slot_start,
        slotEnd: plannedSlot.slot_end,
      };
    }

    const isNegativePriceSlot = plannedSlot.reason?.toLowerCase().includes('negative-price') ?? false;
    const strategy = getChargingStrategy(settings);
    if (!isNegativePriceSlot && strategy === 'opportunistic_topup' && shouldHoldForSolarSurplus(state)) {
      return {
        action: 'hold',
        source: 'solar_surplus',
        reason: 'solar_surplus',
        detail: 'Scheduled opportunistic top-up window is active, but solar surplus is already charging the battery. Holding.',
        slotStart: plannedSlot.slot_start,
        slotEnd: plannedSlot.slot_end,
      };
    }
  }

  return {
    action: scheduleAction,
    source: 'plan',
    reason: 'scheduled_slot',
    detail: plannedSlot.reason || `Planned ${plannedSlot.action} action is active for the current slot.`,
    slotStart: plannedSlot.slot_start,
    slotEnd: plannedSlot.slot_end,
  };
}

export interface UpcomingEvents {
  /**
   * The next plan action that differs from `currentAction`. `null` when every
   * remaining slot in the plan matches the current action (or no plan exists).
   */
  nextAction: PlanAction | null;
  /** ISO start of the slot at which `nextAction` begins. */
  nextActionStart: string | null;
  /**
   * ISO start of the next charge slot that is *not* part of the current
   * contiguous run. If currently charging, this is the start of the next
   * charge run after the current one ends.
   */
  nextChargeStart: string | null;
  /** Same as `nextChargeStart` but for `discharge` slots. */
  nextDischargeStart: string | null;
}

/**
 * Walks the upcoming plan slots starting from `now` and computes a small set
 * of "what's next" timestamps used by the Home Assistant publisher and any
 * other consumer that wants to surface upcoming planner intent.
 *
 * The walk skips the leading run of slots whose action matches `currentAction`
 * so "next charge" / "next discharge" mean "the next *new* run", not the
 * current one. This matches user intuition: while charging, "next charge" is
 * the *following* charge window, not now.
 *
 * Pure plan view — manual/auto overrides and scheduled actions are not
 * considered, since those are short-lived corrections that don't represent
 * the planned schedule the user wants to anticipate.
 */
export function resolveUpcomingEvents(
  now: Date,
  currentAction: PlanAction | null,
): UpcomingEvents {
  const upcoming = getUpcomingPlanSlots(now.toISOString());

  let i = 0;
  // Skip the current contiguous run of matching-action slots so "next" means
  // the next change, not the slot we're already in.
  if (currentAction !== null) {
    while (i < upcoming.length && upcoming[i].action === currentAction) {
      i++;
    }
  }

  let nextAction: PlanAction | null = null;
  let nextActionStart: string | null = null;
  let nextChargeStart: string | null = null;
  let nextDischargeStart: string | null = null;

  for (let k = i; k < upcoming.length; k++) {
    const slot = upcoming[k];
    if (nextAction === null) {
      nextAction = slot.action;
      nextActionStart = slot.slot_start;
    }
    if (nextChargeStart === null && slot.action === 'charge') {
      nextChargeStart = slot.slot_start;
    }
    if (nextDischargeStart === null && slot.action === 'discharge') {
      nextDischargeStart = slot.slot_start;
    }
    if (nextChargeStart !== null && nextDischargeStart !== null) break;
  }

  return { nextAction, nextActionStart, nextChargeStart, nextDischargeStart };
}

const DEFAULT_SLOT_MS = 30 * 60 * 1000;

function addIso(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function buildSingleSlotRange(resolved: ResolvedSlotAction, now: Date): ResolvedSlotRange {
  const rangeStart = resolved.slotStart ?? now.toISOString();
  const rangeEnd = resolved.slotEnd ?? addIso(rangeStart, DEFAULT_SLOT_MS);
  return {
    ...resolved,
    rangeStart,
    rangeEnd,
    slotsInRange: 1,
  };
}

/**
 * Resolves the current slot action and additionally walks forward through
 * contiguous same-action plan slots to compute the full run `[rangeStart, rangeEnd]`.
 *
 * The returned range enables the watchdog to issue a single command at the
 * start of a multi-slot run rather than re-issuing it every tick. Conflation
 * only applies when the current source is `'plan'`; other sources return a
 * single-slot range because they are evaluated dynamically per tick.
 *
 * Conflation stops at:
 *   - a change in action
 *   - a gap in the plan timeline (next slot does not start exactly at the
 *     previous slot's end)
 *   - an intervening manual override covering a future plan slot's start
 *   - an intervening scheduled action that would fire at a future slot's start
 *     (evaluated with the current SOC as a best-effort proxy)
 */
export function resolveSlotActionRange(
  now: Date,
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'>,
  settings: AppSettings,
): ResolvedSlotRange {
  const resolved = resolveSlotAction(now, state, settings);

  if (resolved.source !== 'plan') {
    return buildSingleSlotRange(resolved, now);
  }

  // Source is 'plan' — walk forward through contiguous same-action slots.
  const nowIso = now.toISOString();
  const upcoming = getUpcomingPlanSlots(nowIso);

  // The first returned row should be the currently-active slot (slot_end > now).
  // Locate the entry that matches the resolved current slot's start so the
  // walk begins from the correct position.
  const startIndex = upcoming.findIndex((slot) => slot.slot_start === resolved.slotStart);

  if (startIndex === -1) {
    // Should not normally happen, but fall back to a single-slot range so the
    // watchdog still gets a sane answer rather than an empty one.
    return buildSingleSlotRange(resolved, now);
  }

  let lastEnd = upcoming[startIndex].slot_end;
  let slotsInRange = 1;
  const rangeStart = upcoming[startIndex].slot_start;

  for (let i = startIndex + 1; i < upcoming.length; i++) {
    const next = upcoming[i];

    // Stop on action change.
    if (next.action !== resolved.action) break;

    // Stop on time discontinuity.
    if (next.slot_start !== lastEnd) break;

    // Stop if a manual override covers this slot's start.
    if (getCurrentOverride(next.slot_start)) break;

    // Stop if an auto override covers this slot's start. Auto overrides are
    // short-lived SOC corrections; conflating past them would let the
    // watchdog skip a correction the 5-minute tick inserted.
    if (getCurrentAutoOverride(next.slot_start)) break;

    // Stop if a scheduled action would fire at this slot's start. Evaluated
    // with the current SOC as a best-effort proxy — the next tick will
    // re-resolve anyway if the projection turns out to be wrong.
    if (evaluateScheduledActions(new Date(next.slot_start), state.battery_soc)) break;

    lastEnd = next.slot_end;
    slotsInRange += 1;
  }

  return {
    ...resolved,
    rangeStart,
    rangeEnd: lastEnd,
    slotsInRange,
  };
}
