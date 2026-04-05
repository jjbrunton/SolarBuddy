import { updateScheduleStatus } from '../db/schedule-repository';
import type { ChargeWindow } from './engine';
import { reconcileInverterState } from './watchdog';

/**
 * The executor used to be a second command issuer that ran alongside the
 * watchdog. After Wave 2b it is reduced to a pure schedule-status tracker:
 * at each window boundary it updates the `schedules` row status and nudges
 * the watchdog to reconcile. All inverter commands now flow exclusively
 * through `watchdog.applyIntent`.
 */

const activeTimers: NodeJS.Timeout[] = [];

export function clearScheduledTimers() {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.length = 0;
}

function formatWindow(window: ChargeWindow): string {
  return `${window.type ?? 'charge'} ${window.slot_start} → ${window.slot_end}`;
}

export function scheduleExecution(windows: ChargeWindow[]) {
  clearScheduledTimers();

  for (const window of windows) {
    const startTime = new Date(window.slot_start).getTime();
    const endTime = new Date(window.slot_end).getTime();
    const now = Date.now();

    if (endTime <= now) continue; // Skip past windows

    const startDelay = Math.max(0, startTime - now);
    const endDelay = Math.max(0, endTime - now);

    // Start transition: mark the schedule row as active and let the watchdog
    // pick up the new plan slot on its next reconcile.
    const startTimer = setTimeout(async () => {
      console.log(`[Executor] Window start: ${formatWindow(window)}`);
      try {
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'active');
        await reconcileInverterState(`window start: ${formatWindow(window)}`);
      } catch (err) {
        console.error('[Executor] Failed to transition window to active:', err);
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'failed', String(err));
      }
    }, startDelay);

    // End transition: mark the schedule row as completed and nudge the
    // watchdog so it drops any forced mode and falls back to the next slot
    // (or the default hold).
    const endTimer = setTimeout(async () => {
      console.log(`[Executor] Window end: ${formatWindow(window)}`);
      try {
        updateScheduleStatus(window.slot_start, window.slot_end, window.type, 'completed');
        await reconcileInverterState(`window end: ${formatWindow(window)}`);
      } catch (err) {
        console.error('[Executor] Failed to transition window to completed:', err);
      }
    }, endDelay);

    activeTimers.push(startTimer, endTimer);
  }

  console.log(`[Executor] Scheduled ${windows.length} window transitions`);
}
