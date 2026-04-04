import * as cron from 'node-cron';
import { getSettings } from '../config';
import { resolveRates, getStoredRates } from '../octopus/rates';
import { resolveExportRates } from '../octopus/export-rates';
import { getStoredExportRates } from '../octopus/export-rates';
import { fetchPVForecast } from '../solcast/client';
import { storePVForecast, getStoredPVForecast, getLatestForecastAge } from '../solcast/store';
import { syncInverterTime } from '../inverter/time-sync';
import { checkForTariffChange } from '../octopus/tariff-monitor';
import { getState } from '../state';
import { buildSchedulePlan, getChargingStrategy } from './engine';
import { scheduleExecution } from './executor';
import { persistSchedulePlan } from '../db/schedule-repository';
import { appendEvent } from '../events';
import { notify } from '../notifications/dispatcher';
import type { AgileRate } from '../octopus/rates';

let afternoonJob: cron.ScheduledTask | null = null;
let eveningJob: cron.ScheduledTask | null = null;
let timeSyncJob: cron.ScheduledTask | null = null;
let tariffCheckJob: cron.ScheduledTask | null = null;
let replanJob: cron.ScheduledTask | null = null;

export type ScheduleCycleStatus = 'scheduled' | 'no_rates' | 'no_windows' | 'missing_config' | 'error';

export interface ScheduleCycleResult {
  ok: boolean;
  status: ScheduleCycleStatus;
  message: string;
  windowsCount: number;
}

function logScheduleEvent(level: 'success' | 'warning' | 'error', message: string) {
  appendEvent({
    level,
    category: 'scheduler',
    message,
  });
}

interface PlanInput {
  rates: AgileRate[];
  exportRates: AgileRate[];
  pvForecast: Awaited<ReturnType<typeof getStoredPVForecast>>;
}

/**
 * Build, persist, and optionally execute a schedule plan.
 * Shared core between runScheduleCycle and replanFromStoredRates.
 */
function buildAndPersistPlan(input: PlanInput, label: string): ScheduleCycleResult {
  const settings = getSettings();
  const strategy = getChargingStrategy(settings);
  const strategyLabel = strategy === 'night_fill' ? 'Night Fill' : 'Opportunistic Top-up';
  const state = getState();
  const now = new Date();

  const plan = buildSchedulePlan(input.rates, settings, {
    currentSoc: state.battery_soc,
    now,
    exportRates: input.exportRates,
    pvForecast: input.pvForecast,
  });
  const windows = plan.windows;
  const plannedSlots = plan.slots;

  console.log(`[${label}] Found ${windows.length} planned battery windows`);

  persistSchedulePlan(windows, plannedSlots);

  if (settings.auto_schedule === 'true') {
    scheduleExecution(windows);
  }

  const message = windows.length === 0
    ? `${strategyLabel}${label === 'Replan' ? ' replan' : ''}: no eligible battery windows.`
    : `${strategyLabel}${label === 'Replan' ? ' replan' : ''}: scheduled ${windows.length} battery window${windows.length === 1 ? '' : 's'}.`;
  logScheduleEvent(windows.length === 0 ? 'warning' : 'success', message);
  notify('schedule_updated', 'Schedule Updated', message);

  return {
    ok: true,
    status: windows.length === 0 ? 'no_windows' : 'scheduled',
    message,
    windowsCount: windows.length,
  };
}

export async function runScheduleCycle(): Promise<ScheduleCycleResult> {
  const settings = getSettings();
  const tariffType = settings.tariff_type || 'agile';
  if (tariffType === 'agile' && !settings.octopus_region) {
    console.log('[Cron] No Octopus region configured, skipping');
    logScheduleEvent('warning', 'Configure your Octopus tariff details before running the scheduler.');
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
      logScheduleEvent('warning', 'No Agile rates are available yet for the requested period. Try again after Octopus publishes the next set of prices.');
      return {
        ok: true,
        status: 'no_rates',
        message: 'No Agile rates are available yet for the requested period. Try again after Octopus publishes the next set of prices.',
        windowsCount: 0,
      };
    }

    // Fetch export rates (returns empty array if not configured)
    const exportRates = await resolveExportRates(now.toISOString(), tomorrow.toISOString());
    console.log(`[Cron] Resolved ${exportRates.length} export rates`);

    // Fetch PV forecast from forecast.solar if enabled and stale
    let pvForecast: Awaited<ReturnType<typeof getStoredPVForecast>> = [];
    if (settings.pv_forecast_enabled === 'true' && settings.pv_latitude && settings.pv_longitude && settings.pv_kwp) {
      const ageMinutes = getLatestForecastAge();
      if (ageMinutes > 120) {
        try {
          const fresh = await fetchPVForecast(
            settings.pv_latitude,
            settings.pv_longitude,
            settings.pv_declination || '35',
            settings.pv_azimuth || '0',
            settings.pv_kwp,
          );
          if (fresh.length > 0) {
            storePVForecast(fresh);
          }
          console.log(`[Cron] Fetched ${fresh.length} PV forecast slots from forecast.solar`);
        } catch (err) {
          console.error('[Cron] PV forecast fetch failed:', err);
          logScheduleEvent('warning', `PV forecast fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      pvForecast = getStoredPVForecast(now.toISOString(), tomorrow.toISOString());
      console.log(`[Cron] Using ${pvForecast.length} PV forecast slots`);
    }

    const result = buildAndPersistPlan({ rates, exportRates, pvForecast }, 'Cron');
    console.log('[Cron] Schedule cycle complete');
    return result;
  } catch (err) {
    console.error('[Cron] Schedule cycle failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown scheduler error';
    logScheduleEvent('error', message);
    return {
      ok: false,
      status: 'error',
      message,
      windowsCount: 0,
    };
  }
}

export async function replanFromStoredRates(): Promise<ScheduleCycleResult> {
  const settings = getSettings();
  console.log('[Replan] Rebuilding schedule from stored rates...');

  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const rates = getStoredRates(now.toISOString(), tomorrow.toISOString());
    if (rates.length === 0) {
      console.log('[Replan] No stored rates available, skipping');
      return { ok: true, status: 'no_rates', message: 'No stored rates available for replanning.', windowsCount: 0 };
    }

    const exportRates = getStoredExportRates(now.toISOString(), tomorrow.toISOString());

    let pvForecast: Awaited<ReturnType<typeof getStoredPVForecast>> = [];
    if (settings.pv_forecast_enabled === 'true') {
      pvForecast = getStoredPVForecast(now.toISOString(), tomorrow.toISOString());
    }

    const result = buildAndPersistPlan({ rates, exportRates, pvForecast }, 'Replan');
    console.log(`[Replan] Complete — ${result.windowsCount} windows`);
    return result;
  } catch (err) {
    console.error('[Replan] Failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown replan error';
    logScheduleEvent('error', message);
    return { ok: false, status: 'error', message, windowsCount: 0 };
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

  // Daily inverter time sync at 03:00
  timeSyncJob = cron.schedule('0 3 * * *', async () => {
    const settings = getSettings();
    if (settings.time_sync_enabled === 'true') {
      await syncInverterTime();
    }
  });

  // Daily tariff change check at 06:00
  tariffCheckJob = cron.schedule('0 6 * * *', async () => {
    const settings = getSettings();
    if (settings.tariff_monitor_enabled === 'true' && settings.octopus_api_key) {
      const result = await checkForTariffChange();
      if (result.changed) {
        logScheduleEvent('warning', `Tariff changed to ${result.newProductCode}. Triggering re-schedule.`);
        runScheduleCycle();
      }
    }
  });

  // Periodic replan every 30 minutes using stored rates + current SOC
  replanJob = cron.schedule('2,32 * * * *', () => {
    replanFromStoredRates();
  });

  console.log('[Cron] Scheduled rate fetch: afternoon (4:05pm-8pm) + evening (11:05pm-00:05am)');
  console.log('[Cron] Scheduled replan: every 30 minutes at :02 and :32');
  console.log('[Cron] Scheduled time sync: daily at 03:00, tariff check: daily at 06:00');
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
  if (timeSyncJob) {
    timeSyncJob.stop();
    timeSyncJob = null;
  }
  if (tariffCheckJob) {
    tariffCheckJob.stop();
    tariffCheckJob = null;
  }
  if (replanJob) {
    replanJob.stop();
    replanJob = null;
  }
}
