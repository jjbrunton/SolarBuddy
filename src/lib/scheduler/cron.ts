import * as cron from 'node-cron';
import { getSettings } from '../config';
import { resolveRates, getStoredRates, type AgileRate } from '../octopus/rates';
import { resolveExportRates } from '../octopus/export-rates';
import { getStoredExportRates } from '../octopus/export-rates';
import { fetchPVForecast } from '../solcast/client';
import { storePVForecast, getStoredPVForecast, getLatestForecastAge } from '../solcast/store';
import { syncInverterTime } from '../inverter/time-sync';
import { checkForTariffChange } from '../octopus/tariff-monitor';
import { getState } from '../state';
import { refreshNordpoolForecast } from '../nordpool/refresh';
import { buildSchedulePlan, getChargingStrategy, type ChargeWindow } from './engine';
import { scheduleExecution } from './executor';
import { persistSchedulePlan } from '../db/schedule-repository';
import { appendEvent } from '../events';
import { computeUsageProfile } from '../usage';
import {
  getVirtualExportRates,
  getVirtualForecast,
  getVirtualNow,
  getVirtualRates,
  getVirtualScheduleData,
  isVirtualModeEnabled,
} from '../virtual-inverter/runtime';
import { notify } from '../notifications/dispatcher';
import { evaluateAutoOverrides } from './auto-override';
import { reconcileInverterState } from './watchdog';

const SCHEDULER_TIME_ZONE = 'Europe/London';
const windowTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULER_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatWindowSummary(windows: ChargeWindow[]): string {
  if (windows.length === 0) return '';

  const charge = windows.filter((w) => w.type !== 'discharge');
  const discharge = windows.filter((w) => w.type === 'discharge');

  const lines: string[] = [];

  const formatWindow = (w: ChargeWindow) => {
    const start = windowTimeFormatter.format(new Date(w.slot_start));
    const end = windowTimeFormatter.format(new Date(w.slot_end));
    return `  ${start}–${end} (${w.avg_price.toFixed(1)}p/kWh)`;
  };

  if (charge.length > 0) {
    lines.push(`Charge:`);
    charge.forEach((w) => lines.push(formatWindow(w)));
  }
  if (discharge.length > 0) {
    lines.push(`Discharge:`);
    discharge.forEach((w) => lines.push(formatWindow(w)));
  }

  return '\n' + lines.join('\n');
}

interface CronPersistentState {
  lastPlanFingerprint: string;
}

const g = globalThis as typeof globalThis & {
  __solarbuddy_cron?: CronPersistentState;
};

function getCronState(): CronPersistentState {
  if (!g.__solarbuddy_cron) {
    g.__solarbuddy_cron = { lastPlanFingerprint: '' };
  }
  return g.__solarbuddy_cron;
}

/**
 * Build a semantic fingerprint of a plan so we only notify when the plan's
 * *shape* changes — not when it rolls forward as time passes or when prices
 * drift.
 *
 * The fingerprint intentionally ignores:
 *   - `slot_start` — as past slots are filtered out each replan, the first
 *     window's start advances even though the plan is conceptually unchanged.
 *   - `avg_price` — rate revisions of a few tenths of a p/kWh don't change
 *     what the user cares about (what action ends when).
 *   - Sub-30min jitter on `slot_end` — end times are floored to the nearest
 *     half-hour boundary to absorb ms/tz variations and marginal re-optimisation.
 *
 * It captures: window type, the date in the scheduler's timezone, and the
 * floored half-hour end time. A new window, a removed window, a type flip,
 * or a ≥30min end-time shift will all produce a new fingerprint and notify.
 */
function buildPlanFingerprint(windows: ChargeWindow[]): string {
  return windows
    .map((w) => {
      const end = new Date(w.slot_end);
      // Floor to the nearest 30-min boundary (in UTC — half-hour boundaries
      // align across timezones, so this is safe regardless of SCHEDULER_TIME_ZONE).
      end.setUTCSeconds(0, 0);
      end.setUTCMinutes(end.getUTCMinutes() < 30 ? 0 : 30);
      const date = end.toLocaleDateString('en-CA', { timeZone: SCHEDULER_TIME_ZONE });
      const hhmm = windowTimeFormatter.format(end);
      return `${w.type ?? 'charge'}@${date}T${hhmm}`;
    })
    .sort()
    .join('|');
}

let afternoonJob: cron.ScheduledTask | null = null;
let eveningJob: cron.ScheduledTask | null = null;
let timeSyncJob: cron.ScheduledTask | null = null;
let tariffCheckJob: cron.ScheduledTask | null = null;
let replanJob: cron.ScheduledTask | null = null;
let usageProfileJob: cron.ScheduledTask | null = null;
let autoOverrideJob: cron.ScheduledTask | null = null;
let nordpoolJob: cron.ScheduledTask | null = null;

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

  const fingerprint = buildPlanFingerprint(windows);
  const cronState = getCronState();
  if (fingerprint !== cronState.lastPlanFingerprint) {
    cronState.lastPlanFingerprint = fingerprint;
    notify('schedule_updated', 'Schedule Updated', message + formatWindowSummary(windows));
  }

  return {
    ok: true,
    status: windows.length === 0 ? 'no_windows' : 'scheduled',
    message,
    windowsCount: windows.length,
  };
}

export async function runScheduleCycle(): Promise<ScheduleCycleResult> {
  if (isVirtualModeEnabled()) {
    const settings = getSettings();
    const now = getVirtualNow();
    const rates = getVirtualRates();
    if (rates.length === 0) {
      return {
        ok: false,
        status: 'no_rates',
        message: 'No virtual rates are available for the active scenario.',
        windowsCount: 0,
      };
    }

    const state = getState();
    const plan = buildSchedulePlan(rates, settings, {
      currentSoc: state.battery_soc,
      now,
      exportRates: getVirtualExportRates(),
      pvForecast: getVirtualForecast(),
    });
    const strategy = getChargingStrategy(settings);
    const strategyLabel = strategy === 'night_fill' ? 'Night Fill' : 'Opportunistic Top-up';
    const windows = plan.windows;
    const message = windows.length === 0
      ? `${strategyLabel}: no eligible virtual battery windows were found for the current scenario.`
      : `${strategyLabel}: planned ${windows.length} virtual battery window${windows.length === 1 ? '' : 's'}.`;

    logScheduleEvent(windows.length === 0 ? 'warning' : 'success', message);
    return {
      ok: true,
      status: windows.length === 0 ? 'no_windows' : 'scheduled',
      message,
      windowsCount: windows.length,
    };
  }

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
  if (isVirtualModeEnabled()) {
    const { schedules } = getVirtualScheduleData(getVirtualNow());
    return {
      ok: true,
      status: schedules.length === 0 ? 'no_windows' : 'scheduled',
      message: schedules.length === 0
        ? 'Virtual replan found no eligible battery windows.'
        : `Virtual replan refreshed ${schedules.length} battery window${schedules.length === 1 ? '' : 's'}.`,
      windowsCount: schedules.length,
    };
  }

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

  // Tariff change check every 4 hours at :03
  tariffCheckJob = cron.schedule('3 */4 * * *', async () => {
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

  // Nightly usage-profile refresh at 03:17 local time. Runs after the time-sync
  // job at 03:00 (to avoid clock jumps mid-query) and off-axis from the replan
  // cadence at :02/:32. Skipped when usage learning is disabled in settings.
  usageProfileJob = cron.schedule('17 3 * * *', async () => {
    const settings = getSettings();
    if (settings.usage_learning_enabled !== 'true') return;
    try {
      const result = await computeUsageProfile();
      const msg = result.ok
        ? `Usage profile refresh: ok (${result.stats.total_samples} samples, ${result.stats.dropped_days} days dropped)`
        : `Usage profile refresh skipped: ${result.reason ?? 'unknown reason'}`;
      appendEvent({ level: result.ok ? 'info' : 'warning', category: 'scheduler', message: msg });
    } catch (err) {
      appendEvent({
        level: 'error',
        category: 'scheduler',
        message: `Usage profile refresh failed: ${(err as Error).message}`,
      });
    }
  });

  // Auto-override evaluation every 5 minutes — reacts to SOC excursions
  // without rebuilding the plan. Writes a short-lived override into
  // auto_overrides that the resolver picks up between manual_overrides and
  // scheduled_actions. Any exception is caught and logged so this tick
  // cannot crash the app.
  autoOverrideJob = cron.schedule('*/5 * * * *', async () => {
    try {
      const state = getState();
      const settings = getSettings();
      const decision = evaluateAutoOverrides(new Date(), state, settings);
      if (decision.applied && decision.override) {
        appendEvent({
          level: 'info',
          category: 'auto-override',
          message: `Auto override applied: ${decision.override.source} → ${decision.override.action} (${decision.override.reason})`,
        });
        // Nudge the watchdog so the command flips without waiting for the
        // next 30s tick.
        try {
          await reconcileInverterState('auto-override tick');
        } catch (err) {
          appendEvent({
            level: 'error',
            category: 'auto-override',
            message: `Auto-override reconcile failed: ${(err as Error).message}`,
          });
        }
      }
    } catch (err) {
      try {
        appendEvent({
          level: 'error',
          category: 'auto-override',
          message: `Auto-override tick failed: ${(err as Error).message}`,
        });
      } catch {
        // swallow — cron must never throw
      }
    }
  });

  // Nordpool N2EX day-ahead forecast: fetch at 11:15, 11:30, 11:45 UK time.
  // Provides estimated Agile rates ~5 hours before Octopus publishes.
  nordpoolJob = cron.schedule('15,30,45 11 * * *', async () => {
    const result = await refreshNordpoolForecast();
    if (result.status === 'ok') {
      // Trigger replan with the new forecast rates
      replanFromStoredRates();
    }
  });

  console.log('[Cron] Scheduled rate fetch: afternoon (4:05pm-8pm) + evening (11:05pm-00:05am)');
  console.log('[Cron] Scheduled replan: every 30 minutes at :02 and :32');
  console.log('[Cron] Scheduled time sync: daily at 03:00, tariff check: every 4h at :03');
  console.log('[Cron] Scheduled usage profile refresh: daily at 03:17');
  console.log('[Cron] Scheduled auto-override evaluation: every 5 minutes');
  console.log('[Cron] Scheduled Nordpool day-ahead forecast: 11:15am-11:45am');
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
  if (usageProfileJob) {
    usageProfileJob.stop();
    usageProfileJob = null;
  }
  if (autoOverrideJob) {
    autoOverrideJob.stop();
    autoOverrideJob = null;
  }
  if (nordpoolJob) {
    nordpoolJob.stop();
    nordpoolJob = null;
  }
}

/** Reset persistent cron state — for tests only. */
export function _resetCronStateForTests() {
  g.__solarbuddy_cron = undefined;
}
