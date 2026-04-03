import { getDb } from '../db';
import { appendEvent } from '../events';
import { getSettings } from '../config';
import { resolveOutputSourcePriority } from '../inverter/settings';
import { type PlanAction } from '../plan-actions';
import { evaluateScheduledActions } from '../scheduled-actions';
import { getState, onStateChange } from '../state';
import { type InverterState } from '../types';
import {
  setLoadFirstStopDischarge,
  setWorkMode,
  startGridCharging,
  startGridDischarge,
  startBatteryHold,
  stopGridCharging,
  stopGridDischarge,
} from '../mqtt/commands';
import { getChargingStrategy } from './engine';
import { shouldHoldForSolarSurplus } from './executor';

const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_DEBOUNCE_MS = 1_000;
const COMMAND_COOLDOWN_MS = 120_000;

type RuntimeAction = 'charge' | 'discharge' | 'hold' | 'idle';
type RuntimeReason =
  | 'manual_override'
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

interface WatchdogState {
  interval: NodeJS.Timeout | null;
  debounce: NodeJS.Timeout | null;
  unsubscribe: (() => void) | null;
  running: boolean;
  pendingReasons: Set<string>;
  lastCommandSignature: string | null;
  lastCommandAt: number;
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
    };
  }

  return g.__solarbuddy_watchdog;
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

function getCurrentOverride(nowIso: string): OverrideRow | null {
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

function getCurrentPlanSlot(nowIso: string): PlanSlotRow | null {
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

export function resolveRuntimeIntent(
  now: Date = new Date(),
  state: Pick<InverterState, 'battery_soc' | 'pv_power' | 'grid_power' | 'load_power' | 'battery_power'> = getState(),
): RuntimeIntent {
  const nowIso = now.toISOString();
  const override = getCurrentOverride(nowIso);
  if (override) {
    return {
      action: toRuntimeAction(override.action),
      reason: 'manual_override',
      detail: `Manual override ${override.action} is active for the current slot.`,
      slotStart: override.slot_start,
      slotEnd: override.slot_end,
    };
  }

  // Scheduled actions (user-defined time + SOC rules) take priority over plan slots
  const scheduled = evaluateScheduledActions(now, state.battery_soc);
  if (scheduled) {
    return {
      action: toRuntimeAction(scheduled.action),
      reason: 'scheduled_action',
      detail: scheduled.reason,
    };
  }

  const plannedSlot = getCurrentPlanSlot(nowIso);
  if (!plannedSlot) {
    return {
      action: 'idle',
      reason: 'default_mode',
      detail: 'No active override or schedule window applies right now.',
    };
  }

  const scheduleAction = toRuntimeAction(plannedSlot.action);
  if (scheduleAction === 'charge') {
    const settings = getSettings();
    const minSoc = parseInt(settings.min_soc_target, 10) || 80;

    if (state.battery_soc !== null && state.battery_soc >= minSoc) {
      return {
        action: 'idle',
        reason: 'target_soc_reached',
        detail: `Scheduled charge window is active, but battery SOC is already at or above ${minSoc}%.`,
        slotStart: plannedSlot.slot_start,
        slotEnd: plannedSlot.slot_end,
      };
    }

    const strategy = getChargingStrategy(settings);
    if (strategy === 'opportunistic_topup' && shouldHoldForSolarSurplus(state)) {
      return {
        action: 'idle',
        reason: 'solar_surplus',
        detail: 'Scheduled opportunistic top-up window is active, but solar surplus is already charging the battery.',
        slotStart: plannedSlot.slot_start,
        slotEnd: plannedSlot.slot_end,
      };
    }
  }

  return {
    action: scheduleAction,
    reason: 'scheduled_slot',
    detail: plannedSlot.reason || `Planned ${plannedSlot.action} action is active for the current slot.`,
    slotStart: plannedSlot.slot_start,
    slotEnd: plannedSlot.slot_end,
  };
}

function toRuntimeAction(action: PlanAction): RuntimeAction {
  if (action === 'charge' || action === 'discharge' || action === 'hold') {
    return action;
  }

  return 'idle';
}

function isChargeStateSatisfied(state: InverterState, chargeRate: number): boolean {
  const workModeMatches = state.work_mode === 'Grid first';
  const chargeRateMatches =
    state.battery_first_charge_rate === null || state.battery_first_charge_rate === chargeRate;

  return workModeMatches && chargeRateMatches;
}

function isDischargeStateSatisfied(state: InverterState, defaultMode: string): boolean {
  return state.work_mode === defaultMode && resolveOutputSourcePriority(state) === 'SBU';
}

function isHoldStateSatisfied(state: InverterState): boolean {
  const outputPriority = resolveOutputSourcePriority(state);

  const stopDischargeMatchesSoc =
    state.load_first_stop_discharge !== null &&
    state.battery_soc !== null &&
    state.load_first_stop_discharge >= state.battery_soc - 3 &&
    state.load_first_stop_discharge <= state.battery_soc + 3;

  return (
    state.work_mode === 'Load first' &&
    (outputPriority === null || outputPriority === 'USB' || outputPriority === 'Load first') &&
    stopDischargeMatchesSoc
  );
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
  return state.work_mode === 'Grid first' || isGridChargingFromTelemetry(state);
}

function isForcedDischargeActive(state: InverterState): boolean {
  return resolveOutputSourcePriority(state) === 'SBU';
}

function buildCommandSignature(action: RuntimeAction, slotStart: string | undefined, chargeRate: number, defaultMode: string) {
  return `${action}:${slotStart ?? 'none'}:${chargeRate}:${defaultMode}`;
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

async function ensureStopDischargeAtFloor(state: InverterState): Promise<void> {
  const settings = getSettings();
  const floor = parseInt(settings.discharge_soc_floor, 10);
  const value = Number.isFinite(floor) ? floor : 20;
  if (state.load_first_stop_discharge === value) {
    return;
  }
  await setLoadFirstStopDischarge(value);
}

async function applyIntent(intent: RuntimeIntent, state: InverterState) {
  const settings = getSettings();
  const chargeRate = parseInt(settings.charge_rate, 10) || 100;
  const defaultMode = settings.default_work_mode as 'Battery first' | 'Load first';
  const signature = buildCommandSignature(intent.action, intent.slotStart, chargeRate, defaultMode);

  switch (intent.action) {
    case 'charge': {
      if (isChargeStateSatisfied(state, chargeRate)) {
        clearCommandCooldown();
        return;
      }
      if (shouldRespectCooldown(signature)) {
        return;
      }
      if (isForcedDischargeActive(state)) {
        await stopGridDischarge(defaultMode);
      }
      await ensureStopDischargeAtFloor(state);
      await startGridCharging(chargeRate);
      recordCommand(signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
      return;
    }
    case 'discharge': {
      if (isDischargeStateSatisfied(state, defaultMode)) {
        clearCommandCooldown();
        return;
      }
      if (shouldRespectCooldown(signature)) {
        return;
      }
      if (isForcedChargeActive(state)) {
        await stopGridCharging(defaultMode);
      }
      await ensureStopDischargeAtFloor(state);
      await startGridDischarge(defaultMode);
      recordCommand(signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
      return;
    }
    case 'idle': {
      if (isForcedDischargeActive(state)) {
        await ensureStopDischargeAtFloor(state);
        await stopGridDischarge(defaultMode);
        recordCommand(signature);
        appendEvent({
          level: 'info',
          category: 'watchdog',
          message: intent.detail,
        });
        return;
      }
      if (isForcedChargeActive(state)) {
        await ensureStopDischargeAtFloor(state);
        await stopGridCharging(defaultMode);
        recordCommand(signature);
        appendEvent({
          level: 'info',
          category: 'watchdog',
          message: intent.detail,
        });
        return;
      }
      if (state.work_mode !== null && state.work_mode !== defaultMode) {
        if (shouldRespectCooldown(signature)) {
          return;
        }
        await ensureStopDischargeAtFloor(state);
        await setWorkMode(defaultMode);
        recordCommand(signature);
        appendEvent({
          level: 'info',
          category: 'watchdog',
          message: `Watchdog restored default work mode (${defaultMode}).`,
        });
        return;
      }
      await ensureStopDischargeAtFloor(state);
      clearCommandCooldown();
      return;
    }
    case 'hold': {
      if (isHoldStateSatisfied(state)) {
        clearCommandCooldown();
        return;
      }
      if (shouldRespectCooldown(signature)) {
        return;
      }
      await startBatteryHold(state.battery_soc ?? 50);
      recordCommand(signature);
      appendEvent({
        level: 'info',
        category: 'watchdog',
        message: intent.detail,
      });
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

    const intent = resolveRuntimeIntent(new Date(), state);
    await applyIntent(intent, state);
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
  clearCommandCooldown();
}
