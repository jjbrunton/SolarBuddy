import * as cron from 'node-cron';
import { getSettings } from '../config';
import { resolveRates } from '../octopus/rates';
import { getState } from '../state';
import { buildChargePlan, getChargingStrategy, type ChargeWindow } from './engine';
import { scheduleExecution } from './executor';
import { getDb } from '../db';

let afternoonJob: cron.ScheduledTask | null = null;
let eveningJob: cron.ScheduledTask | null = null;

export type ScheduleCycleStatus = 'scheduled' | 'no_rates' | 'no_windows' | 'missing_config' | 'error';

export interface ScheduleCycleResult {
  ok: boolean;
  status: ScheduleCycleStatus;
  message: string;
  windowsCount: number;
}

export async function runScheduleCycle(): Promise<ScheduleCycleResult> {
  const settings = getSettings();
  const tariffType = settings.tariff_type || 'agile';
  if (tariffType === 'agile' && !settings.octopus_region) {
    console.log('[Cron] No Octopus region configured, skipping');
    return {
      ok: false,
      status: 'missing_config',
      message: 'Configure your Octopus tariff details before running the scheduler.',
      windowsCount: 0,
    };
  }

  console.log('[Cron] Running schedule cycle...');

  try {
    // Fetch rates for next 24 hours
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const rates = await resolveRates(now.toISOString(), tomorrow.toISOString());
    console.log(`[Cron] Fetched ${rates.length} rates`);

    if (rates.length === 0) {
      console.log('[Cron] No rates available yet, will retry');
      return {
        ok: true,
        status: 'no_rates',
        message: 'No Agile rates are available yet for the requested period. Try again after Octopus publishes the next set of prices.',
        windowsCount: 0,
      };
    }

    const strategy = getChargingStrategy(settings);
    const strategyLabel = strategy === 'night_fill' ? 'Night Fill' : 'Opportunistic Top-up';
    const state = getState();
    const windows = buildChargePlan(rates, settings, {
      currentSoc: state.battery_soc,
      now,
    });
    console.log(`[Cron] Found ${windows.length} charge windows`);

    const db = getDb();
    const today = now.toISOString().split('T')[0];

    if (windows.length === 0) {
      db.prepare("DELETE FROM schedules WHERE date = ? AND status = 'planned'").run(today);
      console.log('[Cron] No charge windows to schedule');
      return {
        ok: true,
        status: 'no_windows',
        message: strategy === 'night_fill'
          ? 'Night Fill did not find any eligible slots. Overnight schedules can only be generated after the relevant Agile rates are published.'
          : 'Opportunistic Top-up did not find any eligible slots in the currently published Agile rates.',
        windowsCount: 0,
      };
    }

    // Save to database
    const insert = db.prepare(`
      INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at)
      VALUES (?, ?, ?, ?, 'planned', ?)
    `);
    const insertAll = db.transaction((ws: ChargeWindow[]) => {
      // Clear any existing planned schedules for today
      db.prepare("DELETE FROM schedules WHERE date = ? AND status = 'planned'").run(today);
      for (const w of ws) {
        insert.run(today, w.slot_start, w.slot_end, w.avg_price, new Date().toISOString());
      }
    });
    insertAll(windows);

    // Schedule execution
    if (settings.auto_schedule === 'true') {
      scheduleExecution(windows);
    }

    console.log('[Cron] Schedule cycle complete');
    return {
      ok: true,
      status: 'scheduled',
      message: `${strategyLabel}: scheduled ${windows.length} charge window${windows.length === 1 ? '' : 's'}.`,
      windowsCount: windows.length,
    };
  } catch (err) {
    console.error('[Cron] Schedule cycle failed:', err);
    return {
      ok: false,
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown scheduler error',
      windowsCount: 0,
    };
  }
}

export function startCronJobs() {
  stopCronJobs();

  // Afternoon window: next-day rates typically published ~4pm
  // Retries at 4:05, 4:20, 4:35, then hourly until 8pm
  afternoonJob = cron.schedule('5,20,35 16,17,18,19,20 * * *', () => {
    runScheduleCycle();
  });

  // Evening window: second publication / corrections ~11pm
  // Retries at 11:05, 11:20, 11:35, then 00:05
  eveningJob = cron.schedule('5,20,35 23,0 * * *', () => {
    runScheduleCycle();
  });

  console.log('[Cron] Scheduled rate fetch: afternoon (4:05pm-8pm) + evening (11:05pm-00:05am)');
}

export function stopCronJobs() {
  if (afternoonJob) {
    afternoonJob.stop();
    afternoonJob = null;
  }
  if (eveningJob) {
    eveningJob.stop();
    eveningJob = null;
  }
}
