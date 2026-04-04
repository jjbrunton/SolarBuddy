import { getSettings } from '../config';
import { notify } from '../notifications/dispatcher';
import { getState, onStateChange } from '../state';
import type { InverterState } from '../types';
import { startGridCharging, stopGridCharging, startGridDischarge, stopGridDischarge } from '../mqtt/commands';
import { updateScheduleStatus } from '../db/schedule-repository';
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

type WindowPhase = 'pending' | 'active' | 'completed' | 'failed';

interface WindowState {
  phase: WindowPhase;
  gridChargingActive: boolean;
  evaluationInFlight: boolean;
  monitoringTimer: NodeJS.Timeout | null;
  unsubscribe: (() => void) | null;
}

function createWindowState(): WindowState {
  return {
    phase: 'pending',
    gridChargingActive: false,
    evaluationInFlight: false,
    monitoringTimer: null,
    unsubscribe: null,
  };
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
    const ws = createWindowState();

    const cleanup = () => {
      if (ws.phase === 'completed' || ws.phase === 'failed') return;
      if (ws.monitoringTimer) {
        clearInterval(ws.monitoringTimer);
        ws.monitoringTimer = null;
      }
      if (ws.unsubscribe) {
        ws.unsubscribe();
        ws.unsubscribe = null;
      }
      activeCleanups.delete(cleanup);
    };

    activeCleanups.add(cleanup);

    const completeWindow = async (notes?: string) => {
      if (ws.phase === 'completed' || ws.phase === 'failed') return;
      ws.phase = 'completed';
      cleanup();
      if (ws.gridChargingActive) {
        if (isDischarge) {
          await stopGridDischarge(defaultMode);
        } else {
          await stopGridCharging(defaultMode);
        }
        ws.gridChargingActive = false;
      }
      updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'completed', notes);
    };

    const evaluateWindow = async () => {
      if (ws.phase !== 'active' || ws.evaluationInFlight) return;
      ws.evaluationInFlight = true;

      try {
        const state = getState();

        // Discharge windows run unconditionally for their duration
        if (isDischarge) {
          if (!ws.gridChargingActive) {
            await startGridDischarge();
            ws.gridChargingActive = true;
          }
          return;
        }

        if (state.battery_soc !== null && state.battery_soc >= minSoc) {
          console.log(`[Executor] SOC target reached (${state.battery_soc}% >= ${minSoc}%), stopping early`);
          notify('battery_charged', 'Battery Charged', `Battery reached target SOC of ${minSoc}% (current: ${state.battery_soc}%).`);
          await completeWindow('SOC target reached early');
          return;
        }

        if (strategy === 'opportunistic_topup' && shouldHoldForSolarSurplus(state)) {
          if (ws.gridChargingActive) {
            console.log('[Executor] Solar surplus detected, stopping forced grid charging for opportunistic window');
            await stopGridCharging(defaultMode);
            ws.gridChargingActive = false;
          }
          return;
        }

        if (!ws.gridChargingActive) {
          await startGridCharging(chargeRate);
          ws.gridChargingActive = true;
        }
      } catch (err) {
        console.error('[Executor] Failed to manage charging window:', err);
        ws.phase = 'failed';
        cleanup();
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'failed', String(err));
      } finally {
        ws.evaluationInFlight = false;
      }
    };

    // Schedule start
    const startTimer = setTimeout(async () => {
      console.log(`[Executor] Starting charge window: ${window.slot_start} - ${window.slot_end}`);
      try {
        ws.phase = 'active';
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'active');
        ws.unsubscribe = onStateChange(() => {
          void evaluateWindow();
        });
        ws.monitoringTimer = setInterval(() => {
          void evaluateWindow();
        }, WINDOW_RECHECK_MS);
        await evaluateWindow();
      } catch (err) {
        console.error('[Executor] Failed to start charging:', err);
        ws.phase = 'failed';
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'failed', String(err));
        cleanup();
      }
    }, startDelay);

    // Schedule end
    const endTimer = setTimeout(async () => {
      console.log(`[Executor] Ending charge window: ${window.slot_start} - ${window.slot_end}`);
      cleanup();

      if (ws.phase === 'completed' || ws.phase === 'failed') {
        return;
      }

      ws.phase = 'completed';
      try {
        if (ws.gridChargingActive) {
          if (isDischarge) {
            await stopGridDischarge(defaultMode);
          } else {
            await stopGridCharging(defaultMode);
          }
          ws.gridChargingActive = false;
        }
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'completed');
      } catch (err) {
        console.error('[Executor] Failed to stop charging:', err);
      }
    }, endDelay);

    activeTimers.push(startTimer, endTimer);
  }

  console.log(`[Executor] Scheduled ${windows.length} charge windows`);
}
