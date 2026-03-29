import * as cron from 'node-cron';
import { getSettings } from '../config';
import { fetchAndStoreRates } from '../octopus/rates';
import { findCheapestSlots, type ChargeWindow } from './engine';
import { scheduleExecution } from './executor';
import { getDb } from '../db';

let cronJob: cron.ScheduledTask | null = null;

export async function runScheduleCycle() {
  const settings = getSettings();
  if (!settings.octopus_region) {
    console.log('[Cron] No Octopus region configured, skipping');
    return;
  }

  console.log('[Cron] Running schedule cycle...');

  try {
    // Fetch rates for next 24 hours
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const rates = await fetchAndStoreRates(now.toISOString(), tomorrow.toISOString());
    console.log(`[Cron] Fetched ${rates.length} rates`);

    if (rates.length === 0) {
      console.log('[Cron] No rates available yet, will retry');
      return;
    }

    // Find cheapest slots
    const windows = findCheapestSlots(rates, settings);
    console.log(`[Cron] Found ${windows.length} charge windows`);

    if (windows.length === 0) {
      console.log('[Cron] No charge windows to schedule');
      return;
    }

    // Save to database
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at)
      VALUES (?, ?, ?, ?, 'planned', ?)
    `);
    const today = now.toISOString().split('T')[0];
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
  } catch (err) {
    console.error('[Cron] Schedule cycle failed:', err);
  }
}

export function startCronJobs() {
  if (cronJob) {
    cronJob.stop();
  }

  // Run at 4:05pm, 4:20pm, 4:35pm, 5pm, 6pm, 7pm, 8pm daily
  // Retries in case rates aren't available yet
  cronJob = cron.schedule('5,20,35 16,17,18,19,20 * * *', () => {
    runScheduleCycle();
  });

  console.log('[Cron] Scheduled daily rate fetch (4:05pm-8pm)');
}

export function stopCronJobs() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
