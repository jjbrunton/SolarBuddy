import { getDb } from '../db';
import { getSettings } from '../config';
import { getState, onStateChange } from '../state';
import type { InverterState } from '../types';
import { startGridCharging, stopGridCharging, startGridDischarge, stopGridDischarge } from '../mqtt/commands';
import { ChargeWindow, getChargingStrategy } from './engine';

const activeTimers: NodeJS.Timeout[] = [];
const activeCleanups = new Set<() => void>();
const WINDOW_RECHECK_MS = 60_000;
const POWER_TOLERANCE_W = 50;

export function clearScheduledTimers() {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.length = 0;

  for (const cleanup of activeCleanups) {
    cleanup();
  }
  activeCleanups.clear();
}

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

export function scheduleExecution(windows: ChargeWindow[]) {
  clearScheduledTimers();
  const settings = getSettings();
  const chargeRate = parseInt(settings.charge_rate) || 100;
  const defaultMode = settings.default_work_mode as 'Battery first' | 'Load first';
  const minSoc = parseInt(settings.min_soc_target) || 80;
  const strategy = getChargingStrategy(settings);

  for (const window of windows) {
    const startTime = new Date(window.slot_start).getTime();
    const endTime = new Date(window.slot_end).getTime();
    const now = Date.now();
    const isDischarge = window.type === 'discharge';

    if (endTime <= now) continue; // Skip past windows

    const startDelay = Math.max(0, startTime - now);
    const endDelay = endTime - now;
    let monitoringTimer: NodeJS.Timeout | null = null;
    let unsubscribe: (() => void) | null = null;
    let gridChargingActive = false;
    let completed = false;
    let cleaningUp = false;
    let evaluationInFlight = false;

    const cleanup = () => {
      if (cleaningUp) return;
      cleaningUp = true;
      if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      activeCleanups.delete(cleanup);
      cleaningUp = false;
    };

    activeCleanups.add(cleanup);

    const completeWindow = async (notes?: string) => {
      if (completed) return;
      completed = true;
      cleanup();
      if (gridChargingActive) {
        if (isDischarge) {
          await stopGridDischarge(defaultMode);
        } else {
          await stopGridCharging(defaultMode);
        }
        gridChargingActive = false;
      }
      updateScheduleStatus(window, 'completed', notes);
    };

    const evaluateWindow = async () => {
      if (completed || evaluationInFlight) return;
      evaluationInFlight = true;

      try {
        const state = getState();

        // Discharge windows run unconditionally for their duration
        if (isDischarge) {
          if (!gridChargingActive) {
            await startGridDischarge();
            gridChargingActive = true;
          }
          return;
        }

        if (state.battery_soc !== null && state.battery_soc >= minSoc) {
          console.log(`[Executor] SOC target reached (${state.battery_soc}% >= ${minSoc}%), stopping early`);
          await completeWindow('SOC target reached early');
          return;
        }

        if (strategy === 'opportunistic_topup' && shouldHoldForSolarSurplus(state)) {
          if (gridChargingActive) {
            console.log('[Executor] Solar surplus detected, stopping forced grid charging for opportunistic window');
            await stopGridCharging(defaultMode);
            gridChargingActive = false;
          }
          return;
        }

        if (!gridChargingActive) {
          await startGridCharging(chargeRate);
          gridChargingActive = true;
        }
      } catch (err) {
        console.error('[Executor] Failed to manage charging window:', err);
        completed = true;
        cleanup();
        updateScheduleStatus(window, 'failed', String(err));
      } finally {
        evaluationInFlight = false;
      }
    };

    // Schedule start
    const startTimer = setTimeout(async () => {
      console.log(`[Executor] Starting charge window: ${window.slot_start} - ${window.slot_end}`);
      try {
        updateScheduleStatus(window, 'active');
        unsubscribe = onStateChange(() => {
          void evaluateWindow();
        });
        monitoringTimer = setInterval(() => {
          void evaluateWindow();
        }, WINDOW_RECHECK_MS);
        await evaluateWindow();
      } catch (err) {
        console.error('[Executor] Failed to start charging:', err);
        updateScheduleStatus(window, 'failed', String(err));
        completed = true;
        cleanup();
      }
    }, startDelay);

    // Schedule end
    const endTimer = setTimeout(async () => {
      console.log(`[Executor] Ending charge window: ${window.slot_start} - ${window.slot_end}`);
      cleanup();

      if (completed) {
        return;
      }

      completed = true;
      try {
        if (gridChargingActive) {
          if (isDischarge) {
            await stopGridDischarge(defaultMode);
          } else {
            await stopGridCharging(defaultMode);
          }
          gridChargingActive = false;
        }
        updateScheduleStatus(window, 'completed');
      } catch (err) {
        console.error('[Executor] Failed to stop charging:', err);
      }
    }, endDelay);

    activeTimers.push(startTimer, endTimer);
  }

  console.log(`[Executor] Scheduled ${windows.length} charge windows`);
}

function updateScheduleStatus(window: ChargeWindow, status: string, notes?: string) {
  try {
    const db = getDb();
    const update = notes
      ? db.prepare('UPDATE schedules SET status = ?, executed_at = ?, notes = ? WHERE slot_start = ? AND status != ?')
      : db.prepare('UPDATE schedules SET status = ?, executed_at = ? WHERE slot_start = ? AND status != ?');

    if (notes) {
      update.run(status, new Date().toISOString(), notes, window.slot_start, 'completed');
    } else {
      update.run(status, new Date().toISOString(), window.slot_start, 'completed');
    }
  } catch (err) {
    console.error('[Executor] Failed to update schedule status:', err);
  }
}
