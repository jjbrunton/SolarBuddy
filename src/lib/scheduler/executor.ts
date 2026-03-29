import { getDb } from '../db';
import { getSettings } from '../config';
import { getState, onStateChange } from '../state';
import { startGridCharging, stopGridCharging } from '../mqtt/commands';
import { ChargeWindow } from './engine';

const activeTimers: NodeJS.Timeout[] = [];

export function clearScheduledTimers() {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.length = 0;
}

export function scheduleExecution(windows: ChargeWindow[]) {
  clearScheduledTimers();
  const settings = getSettings();
  const chargeRate = parseInt(settings.charge_rate) || 100;
  const defaultMode = settings.default_work_mode as 'Battery first' | 'Load first';
  const minSoc = parseInt(settings.min_soc_target) || 80;

  for (const window of windows) {
    const startTime = new Date(window.slot_start).getTime();
    const endTime = new Date(window.slot_end).getTime();
    const now = Date.now();

    if (endTime <= now) continue; // Skip past windows

    const startDelay = Math.max(0, startTime - now);
    const endDelay = endTime - now;

    // Schedule start
    const startTimer = setTimeout(async () => {
      console.log(`[Executor] Starting charge window: ${window.slot_start} - ${window.slot_end}`);
      try {
        await startGridCharging(chargeRate);
        updateScheduleStatus(window, 'active');

        // Monitor SOC for early termination
        const unsubscribe = onStateChange((state) => {
          if (state.battery_soc !== null && state.battery_soc >= minSoc) {
            console.log(`[Executor] SOC target reached (${state.battery_soc}% >= ${minSoc}%), stopping early`);
            stopGridCharging(defaultMode).catch(console.error);
            updateScheduleStatus(window, 'completed', 'SOC target reached early');
            unsubscribe();
          }
        });

        // Clean up SOC monitor when window ends
        setTimeout(() => unsubscribe(), endDelay - startDelay);
      } catch (err) {
        console.error('[Executor] Failed to start charging:', err);
        updateScheduleStatus(window, 'failed', String(err));
      }
    }, startDelay);

    // Schedule end
    const endTimer = setTimeout(async () => {
      console.log(`[Executor] Ending charge window: ${window.slot_start} - ${window.slot_end}`);
      try {
        await stopGridCharging(defaultMode);
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
