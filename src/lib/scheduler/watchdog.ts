import { appendEvent } from '../events';
import { getSettings } from '../config';
import {
  getLatestExecutionForSlot,
  recordSlotExecution,
  updateSlotExecutionActuals,
  type OverrideSource,
} from '../db/schedule-repository';
import { resolveOutputSourcePriority } from '../inverter/settings';
import { notify } from '../notifications/dispatcher';
import { type PlanAction } from '../plan-actions';
import { getState, onStateChange } from '../state';
import { type InverterState } from '../types';
import {
  setLoadFirstStopDischarge,
  startGridCharging,
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
} from '../inverter/commands';
import { getVirtualNow } from '../virtual-inverter/runtime';
import {
  resolveSlotAction,
  resolveSlotActionRange,
  resolveUpcomingEvents,
  type ResolvedSlotAction,
  type ResolvedSlotRange,
  type SlotActionSource,
  type UpcomingEvents,
} from './resolve';

const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_DEBOUNCE_MS = 1_000;
const COMMAND_COOLDOWN_MS = 120_000;
// Wider than a single telemetry push cycle so a brief MQTT gap doesn't defeat
// the satisfaction gate and force re-issues that only the cooldown catches.
const STATE_FRESHNESS_MS = 180_000;
// Charge rate read-backs can round or lag the written value by a small
// amount. Treat anything within this tolerance as "already satisfied" so a
// rounded read-back doesn't trigger a re-write every cooldown expiry.
const CHARGE_RATE_TOLERANCE_PP = 2;

type RuntimeAction = PlanAction;
type RuntimeReason =
  | 'manual_override'
  | 'auto_override'
  | 'scheduled_action'
  | 'scheduled_slot'
  | 'target_soc_reached'
  | 'solar_surplus'
  | 'default_mode';

interface RuntimeIntent {
  action: RuntimeAction;
  reason: RuntimeReason;
  detail: string;
  slotStart?: string;
  slotEnd?: string;
  rangeStart?: string;
  rangeEnd?: string;
  slotsInRange?: number;
  /**
   * The resolver source that produced this intent. Preserved so the watchdog
   * can attribute the `plan_slot_executions` row to the correct override tier
   * without having to re-resolve.
   */
  source?: SlotActionSource;
}

interface WatchdogState {
  interval: NodeJS.Timeout | null;
  debounce: NodeJS.Timeout | null;
  unsubscribe: (() => void) | null;
  running: boolean;
  pendingReasons: Set<string>;
  lastCommandSignature: string | null;
  lastCommandAt: number;
  lastBatteryExhaustedAt: number;
  lastNotifiedAction: RuntimeAction | null;
  /**
   * `rangeStart` of the previous tick's resolved slot range. Used by the
   * slot-end backfill to detect when the watchdog has crossed a slot/run
   * boundary and update the prior execution row's `soc_at_end`.
   */
  lastResolvedRangeStart: string | null;
  /**
   * The `load_first_stop_discharge` value we most recently pinned on a hold
   * write, or `null` if the last applied action was not hold. Hold pins
   * stop_discharge to the SOC at write time; if we compared against live SOC
   * every tick, natural drift from solar top-up or self-consumption would
   * flag the hold as unsatisfied and re-pin repeatedly. Tracking the pinned
   * value lets us consider hold satisfied as long as the inverter still
   * reports back what we wrote — regardless of SOC drift.
   */
  lastHoldAssertedStopDischarge: number | null;
}

const g = globalThis as typeof globalThis & {
  __solarbuddy_watchdog?: WatchdogState;
};

function getWatchdogState(): WatchdogState {
  if (!g.__solarbuddy_watchdog) {
    g.__solarbuddy_watchdog = {
      interval: null,
      debounce: null,
      unsubscribe: null,
      running: false,
      pendingReasons: new Set(),
      lastCommandSignature: null,
      lastCommandAt: 0,
      lastBatteryExhaustedAt: 0,
      lastNotifiedAction: null,
      lastResolvedRangeStart: null,
      lastHoldAssertedStopDischarge: null,
    };
  }

  return g.__solarbuddy_watchdog;
}

/**
 * Maps the resolver's `SlotActionSource` to the `OverrideSource` enum used by
 * the `plan_slot_executions` table. The two types currently share identical
 * members, but they live in different modules; this helper keeps the mapping
 * explicit so any future divergence is caught at compile time.
 */
const SOURCE_TO_OVERRIDE_SOURCE: Record<SlotActionSource, OverrideSource> = {
  manual: 'manual',
  auto: 'auto',
  scheduled: 'scheduled',
  plan: 'plan',
  target_soc: 'target_soc',
  solar_surplus: 'solar_surplus',
  default: 'default',
};

function mapSourceToOverrideSource(source: SlotActionSource): OverrideSource {
  return SOURCE_TO_OVERRIDE_SOURCE[source];
}

function parseEnabledState(value: string | null): boolean | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'true', 'enabled', 'enable', 'on', 'yes'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'disabled', 'disable', 'off', 'no'].includes(normalized)) {
    return false;
  }

  return null;
}

export function isWatchdogEnabled(): boolean {
  const parsed = parseEnabledState(getSettings().watchdog_enabled ?? null);
  return parsed ?? true;
}

const SOURCE_TO_REASON: Record<ResolvedSlotAction['source'], RuntimeReason> = {
  manual: 'manual_override',
  auto: 'auto_override',
  scheduled: 'scheduled_action',
  target_soc: 'target_soc_reached',
  solar_surplus: 'solar_surplus',
  plan: 'scheduled_slot',
  default: 'default_mode',
};

/**
 * Returns the resolved slot action in its canonical shape. Prefer this for
 * new callers (UI, notifications, diagnostics) so the watchdog and the UI
 * cannot disagree about what the scheduler is currently doing.
 */
export function getResolvedSlotAction(
  now: Date = new Date(),
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'> = getState(),
): ResolvedSlotAction {
  return resolveSlotAction(now, state, getSettings());
}

/**
 * Returns the next planned action and the start of the next charge/discharge
 * runs after the current one. Used by the HA publisher so dashboards and
 * automations can anticipate the planner without re-implementing the walk.
 */
export function getUpcomingEvents(
  now: Date = new Date(),
  currentAction: PlanAction | null,
): UpcomingEvents {
  return resolveUpcomingEvents(now, currentAction);
}

/**
 * Returns the resolved slot action conflated across any contiguous same-action
 * plan slots. The returned range lets the watchdog issue a single command at
 * the start of a multi-slot run instead of reissuing it every tick.
 */
export function getResolvedSlotActionRange(
  now: Date = new Date(),
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'> = getState(),
): ResolvedSlotRange {
  return resolveSlotActionRange(now, state, getSettings());
}

/**
 * @deprecated Prefer getResolvedSlotAction for new code. This adapter is kept
 * so the watchdog's legacy consumers and tests continue to work unchanged.
 */
export function resolveRuntimeIntent(
  now: Date = new Date(),
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'> = getState(),
): RuntimeIntent {
  const resolved = getResolvedSlotAction(now, state);
  return {
    action: resolved.action,
    reason: SOURCE_TO_REASON[resolved.source],
    detail: resolved.detail,
    slotStart: resolved.slotStart,
    slotEnd: resolved.slotEnd,
  };
}

/**
 * Resolves the current intent and conflates contiguous same-action plan slots
 * into a single range. Used internally by the watchdog so the cooldown
 * signature stays stable across every tick of a multi-slot run.
 */
export function resolveRuntimeIntentRange(
  now: Date = new Date(),
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'> = getState(),
): RuntimeIntent {
  const resolved = getResolvedSlotActionRange(now, state);
  return {
    action: resolved.action,
    reason: SOURCE_TO_REASON[resolved.source],
    detail: resolved.detail,
    slotStart: resolved.slotStart,
    slotEnd: resolved.slotEnd,
    rangeStart: resolved.rangeStart,
    rangeEnd: resolved.rangeEnd,
    slotsInRange: resolved.slotsInRange,
    source: resolved.source,
  };
}

function isChargeStateSatisfied(state: InverterState, chargeRate: number): boolean {
  const workModeMatches = state.work_mode === 'Battery first';
  const chargeRateMatches =
    state.battery_first_charge_rate === null ||
    Math.abs(state.battery_first_charge_rate - chargeRate) <= CHARGE_RATE_TOLERANCE_PP;

  return workModeMatches && chargeRateMatches;
}

function isDischargeStateSatisfied(state: InverterState, floor: number): boolean {
  if (state.work_mode !== 'Load first') return false;
  if (isGridChargingFromTelemetry(state)) return false;
  if (state.load_first_stop_discharge !== null && state.load_first_stop_discharge !== floor) return false;
  return true;
}

function isHoldStateSatisfied(
  state: InverterState,
  runtime: WatchdogState,
): boolean {
  if (isForcedChargeActive(state) || isForcedDischargeActive(state)) {
    return false;
  }
  if (state.work_mode !== 'Load first') return false;
  if (state.load_first_stop_discharge === null) return false;
  if (runtime.lastHoldAssertedStopDischarge === null) return false;

  // Hold is satisfied as long as the inverter still reports the stop_discharge
  // we last pinned. Natural SOC drift from solar top-up or self-consumption
  // does not trigger a re-pin; only an external mutation (work_mode flipped,
  // or stop_discharge changed) or a transition out of hold falls through and
  // re-asserts. This avoids hammering the inverter during long hold runs.
  return state.load_first_stop_discharge === runtime.lastHoldAssertedStopDischarge;
}

function isGridChargingFromTelemetry(state: Pick<InverterState, 'battery_power' | 'grid_power' | 'load_power' | 'pv_power'>): boolean {
  if (state.battery_power === null || state.battery_power <= 50) {
    return false;
  }

  if (state.grid_power === null || state.grid_power <= 50) {
    return false;
  }

  if (state.load_power !== null && state.pv_power !== null) {
    const expectedImportForLoad = Math.max(0, state.load_power - state.pv_power);
    return state.grid_power > expectedImportForLoad + 50;
  }

  return true;
}

function isForcedChargeActive(state: InverterState): boolean {
  return state.work_mode === 'Battery first' || isGridChargingFromTelemetry(state);
}

function isForcedDischargeActive(state: InverterState): boolean {
  return resolveOutputSourcePriority(state) === 'SBU';
}

function buildCommandSignature(
  action: RuntimeAction,
  rangeStart: string | undefined,
  rangeEnd: string | undefined,
  chargeRate: number,
  defaultMode: string,
) {
  return `${action}:${rangeStart ?? 'none'}:${rangeEnd ?? 'none'}:${chargeRate}:${defaultMode}`;
}

/**
 * State is considered fresh enough to trust for the satisfaction check only
 * if we have a recent `last_updated` timestamp from the inverter. Stale or
 * missing telemetry forces the watchdog to issue the write so we don't rely
 * on outdated readings.
 */
function isStateFresh(state: InverterState): boolean {
  if (!state.last_updated) return false;
  const ageMs = Date.now() - new Date(state.last_updated).getTime();
  if (!Number.isFinite(ageMs)) return false;
  return ageMs >= 0 && ageMs <= STATE_FRESHNESS_MS;
}

function shouldRespectCooldown(signature: string): boolean {
  const runtime = getWatchdogState();
  return runtime.lastCommandSignature === signature && Date.now() - runtime.lastCommandAt < COMMAND_COOLDOWN_MS;
}

function recordCommand(signature: string) {
  const runtime = getWatchdogState();
  runtime.lastCommandSignature = signature;
  runtime.lastCommandAt = Date.now();
}

function clearCommandCooldown() {
  const runtime = getWatchdogState();
  runtime.lastCommandSignature = null;
  runtime.lastCommandAt = 0;
}

const DEFAULT_EXECUTION_SLOT_MS = 30 * 60 * 1000;

/**
 * Appends a row to `plan_slot_executions` describing the command the watchdog
 * just issued. Only called on the success path of an actual inverter write —
 * the state-satisfied and cooldown-blocked paths must not log here, otherwise
 * the execution log would stop reflecting "commands actually sent".
 */
function logSlotExecution(intent: RuntimeIntent, state: InverterState, signature: string) {
  try {
    const nowIso = new Date().toISOString();
    const slotStart = intent.rangeStart ?? intent.slotStart ?? nowIso;
    const slotEnd =
      intent.rangeEnd ??
      intent.slotEnd ??
      new Date(new Date(slotStart).getTime() + DEFAULT_EXECUTION_SLOT_MS).toISOString();

    recordSlotExecution({
      slot_start: slotStart,
      slot_end: slotEnd,
      action: intent.action,
      reason: intent.reason ?? null,
      override_source: mapSourceToOverrideSource(intent.source ?? 'default'),
      soc_at_start: state.battery_soc,
      soc_at_end: null,
      command_signature: signature,
      command_issued_at: nowIso,
      actual_import_wh: null,
      actual_export_wh: null,
      notes: null,
    });
  } catch (err) {
    // Never let an instrumentation failure break the watchdog command path.
    appendEvent({
      level: 'warning',
      category: 'watchdog',
      message:
        err instanceof Error
          ? `Failed to record plan slot execution: ${err.message}`
          : 'Failed to record plan slot execution.',
    });
  }
}

/**
 * Simpler `soc_at_end` backfill strategy: on every tick, compare the newly
 * resolved range start to the previous tick's range start. When they differ,
 * the previous run just ended, so update its latest execution row with the
 * current SOC as `soc_at_end`.
 *
 * Limitations:
 *   - No tick ever fires *after* the final slot of a plan (e.g. process shut
 *     down during the last run), so that final row will be left with
 *     `soc_at_end = NULL`. Accepted as a known edge case — downstream analytics
 *     should tolerate NULLs here.
 *   - If the watchdog crashes between ticks, the boundary is missed.
 *   - The first tick after process start has no previous range stored, so it
 *     is treated as the beginning of a new run (no backfill).
 */
function backfillPreviousSlotSocAtEnd(
  previousRangeStart: string | null,
  currentRangeStart: string | null,
  state: InverterState,
) {
  if (!previousRangeStart) return;
  if (!currentRangeStart) return;
  if (previousRangeStart === currentRangeStart) return;
  if (state.battery_soc === null) return;

  try {
    const previous = getLatestExecutionForSlot(previousRangeStart);
    if (!previous) return;
    if (previous.soc_at_end !== null && previous.soc_at_end !== undefined) return;
    updateSlotExecutionActuals(previous.id, { soc_at_end: state.battery_soc });
  } catch (err) {
    appendEvent({
      level: 'warning',
      category: 'watchdog',
      message:
        err instanceof Error
          ? `Failed to backfill soc_at_end on slot boundary: ${err.message}`
          : 'Failed to backfill soc_at_end on slot boundary.',
    });
  }
}

async function ensureStopDischargeAtFloor(state: InverterState): Promise<void> {
  const settings = getSettings();
  const floor = parseInt(settings.discharge_soc_floor, 10);
  const value = Number.isFinite(floor) ? floor : 20;
  if (state.load_first_stop_discharge === value) {
    return;
  }
  await setLoadFirstStopDischarge(value);
}

function notifyIfActionChanged(action: RuntimeAction, title: string, body: string) {
  const runtime = getWatchdogState();
  if (runtime.lastNotifiedAction === action) return;
  runtime.lastNotifiedAction = action;
  notify('state_change', title, body);
}

function logStateSatisfied(action: RuntimeAction) {
  appendEvent({
    level: 'info',
    category: 'watchdog',
    message: `[Watchdog] State already satisfied for ${action} — suppressing write.`,
  });
}

/**
 * Returns true when the desired inverter state already matches the reported
 * state AND the telemetry is fresh enough to trust. This is the primary gate
 * for write suppression — if it returns true, we skip the command entirely.
 * Stale telemetry falls through so the watchdog re-asserts the command.
 */
function isIntentAlreadySatisfied(
  intent: RuntimeIntent,
  state: InverterState,
  chargeRate: number,
  floor: number,
  runtime: WatchdogState,
): boolean {
  if (!isStateFresh(state)) return false;

  switch (intent.action) {
    case 'charge':
      return isChargeStateSatisfied(state, chargeRate);
    case 'discharge':
      return isDischargeStateSatisfied(state, floor);
    case 'hold':
      return isHoldStateSatisfied(state, runtime);
    default:
      return false;
  }
}

async function applyIntent(intent: RuntimeIntent, state: InverterState) {
  const settings = getSettings();
  const chargeRate = parseInt(settings.charge_rate, 10) || 100;
  const defaultMode = settings.default_work_mode as 'Battery first' | 'Load first';
  const floorRaw = parseInt(settings.discharge_soc_floor, 10);
  const floor = Number.isFinite(floorRaw) ? floorRaw : 20;
  const runtime = getWatchdogState();
  const signature = buildCommandSignature(
    intent.action,
    intent.rangeStart ?? intent.slotStart,
    intent.rangeEnd ?? intent.slotEnd,
    chargeRate,
    defaultMode,
  );

  // Primary gate: if the inverter already reports the desired state and the
  // telemetry is fresh, skip the write entirely. We deliberately do NOT touch
  // the cooldown timers here — a subsequent drift should still be able to
  // re-issue the command immediately without waiting for the 120s cooldown.
  if (isIntentAlreadySatisfied(intent, state, chargeRate, floor, runtime)) {
    logStateSatisfied(intent.action);
    return;
  }

  // Secondary safety net: time-based dedup. Only blocks when the signature
  // matches a recent write, i.e. we already asked the inverter for this and
  // it hasn't had a chance to respond yet.
  if (shouldRespectCooldown(signature)) {
    return;
  }

  switch (intent.action) {
    case 'charge': {
      if (isForcedDischargeActive(state)) {
        await stopGridDischarge(defaultMode);
      }
      await ensureStopDischargeAtFloor(state);
      await startGridCharging(chargeRate);
      recordCommand(signature);
      runtime.lastHoldAssertedStopDischarge = null;
      logSlotExecution(intent, state, signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
      notifyIfActionChanged('charge', 'Charging Started', intent.detail);
      return;
    }
    case 'discharge': {
      if (isForcedChargeActive(state)) {
        await stopGridCharging(defaultMode);
      }
      await ensureStopDischargeAtFloor(state);
      await startGridDischarge(defaultMode);
      recordCommand(signature);
      runtime.lastHoldAssertedStopDischarge = null;
      logSlotExecution(intent, state, signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
      notifyIfActionChanged('discharge', 'Discharge Started', intent.detail);
      return;
    }
    case 'hold': {
      // Clear any forced state first so the hold lands cleanly on Load first + pinned SOC.
      if (isForcedDischargeActive(state)) {
        await stopGridDischarge(defaultMode);
      }
      if (isForcedChargeActive(state)) {
        await stopGridCharging(defaultMode);
      }
      const pinnedStopDischarge = state.battery_soc ?? 50;
      await startBatteryHold(pinnedStopDischarge);
      recordCommand(signature);
      runtime.lastHoldAssertedStopDischarge = pinnedStopDischarge;
      logSlotExecution(intent, state, signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
      notifyIfActionChanged('hold', 'Battery Hold Active', intent.detail);
      return;
    }
  }
}

export async function reconcileInverterState(reason = 'manual trigger') {
  const runtime = getWatchdogState();
  if (runtime.running) {
    runtime.pendingReasons.add(reason);
    return;
  }

  runtime.running = true;
  runtime.pendingReasons.add(reason);

  try {
    runtime.pendingReasons.clear();
    const state = getState();

    if (!state.mqtt_connected) {
      clearCommandCooldown();
      return;
    }

    const intent = resolveRuntimeIntentRange(getVirtualNow(), state);

    // Slot-end backfill: if we've crossed a slot/run boundary since the last
    // tick, stamp `soc_at_end` onto the previous run's latest execution row
    // before we apply and log the new run's intent. Runs on every tick, not
    // only when a new command fires, so it still catches boundary crossings
    // where the new run is state-satisfied.
    const currentRangeStart = intent.rangeStart ?? intent.slotStart ?? null;
    backfillPreviousSlotSocAtEnd(runtime.lastResolvedRangeStart, currentRangeStart, state);
    runtime.lastResolvedRangeStart = currentRangeStart;

    await applyIntent(intent, state);

    // Battery exhausted detection (30-minute cooldown)
    const settings = getSettings();
    const floor = parseInt(settings.discharge_soc_floor, 10) || 20;
    if (
      state.battery_soc !== null &&
      state.battery_soc <= floor &&
      intent.action !== 'charge' &&
      Date.now() - runtime.lastBatteryExhaustedAt > 30 * 60 * 1000
    ) {
      runtime.lastBatteryExhaustedAt = Date.now();
      notify('battery_exhausted', 'Battery Exhausted', `Battery SOC has reached the discharge floor of ${floor}% (current: ${state.battery_soc}%).`);
    }
  } catch (err) {
    appendEvent({
      level: 'error',
      category: 'watchdog',
      message: err instanceof Error ? `Watchdog reconciliation failed: ${err.message}` : 'Watchdog reconciliation failed.',
    });
  } finally {
    runtime.running = false;
    if (runtime.pendingReasons.size > 0) {
      void reconcileInverterState('queued follow-up');
    }
  }
}

export function queueInverterReconciliation(reason = 'state change') {
  const runtime = getWatchdogState();
  runtime.pendingReasons.add(reason);

  if (runtime.debounce) {
    return;
  }

  runtime.debounce = setTimeout(() => {
    runtime.debounce = null;
    void reconcileInverterState(reason);
  }, WATCHDOG_DEBOUNCE_MS);
}

export function startInverterWatchdog() {
  if (!isWatchdogEnabled()) {
    stopInverterWatchdog();
    return;
  }

  const runtime = getWatchdogState();

  if (!runtime.interval) {
    runtime.interval = setInterval(() => {
      void reconcileInverterState('watchdog interval');
    }, WATCHDOG_INTERVAL_MS);
  }

  if (!runtime.unsubscribe) {
    runtime.unsubscribe = onStateChange((state) => {
      if (state.mqtt_connected) {
        queueInverterReconciliation('telemetry update');
      }
    });
  }

  void reconcileInverterState('watchdog startup');
}

export function syncInverterWatchdogSetting() {
  if (isWatchdogEnabled()) {
    startInverterWatchdog();
    return;
  }

  stopInverterWatchdog();
}

export function stopInverterWatchdog() {
  const runtime = getWatchdogState();
  if (runtime.interval) {
    clearInterval(runtime.interval);
    runtime.interval = null;
  }
  if (runtime.debounce) {
    clearTimeout(runtime.debounce);
    runtime.debounce = null;
  }
  if (runtime.unsubscribe) {
    runtime.unsubscribe();
    runtime.unsubscribe = null;
  }
  runtime.pendingReasons.clear();
  runtime.running = false;
  runtime.lastResolvedRangeStart = null;
  runtime.lastHoldAssertedStopDischarge = null;
  clearCommandCooldown();
}
