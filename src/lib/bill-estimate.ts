/**
 * Daily bill estimation: combines actual cost (elapsed slots) with projected
 * cost (remaining slots) to produce a PredBat-style "estimated bill for today
 * is X and tomorrow is Y".
 *
 * Algorithm per half-hour slot:
 *  - hold:      net_grid = consumption - pv  (grid covers load, PV reduces import)
 *  - charge:    net_grid = consumption - pv + charge_power  (battery charges from grid)
 *  - discharge: net_grid = consumption - pv - battery_supply  (battery load-follows)
 *
 * If net_grid > 0 -> import cost = (kWh) * import_rate
 * If net_grid < 0 -> export revenue = (kWh) * export_rate
 */

import { getDb } from './db';
import { getStoredImportRates, getStoredExportRates } from './db/rate-repository';
import { getStoredPVForecast } from './solcast/store';
import { getForecastedConsumptionW } from './usage/repository';
import { getSettings } from './config';
import { getDailyPnL } from './accounting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DayBillEstimate {
  date: string;
  actual_cost_pence: number;
  forecast_cost_pence: number;
  total_cost_pence: number;
  import_kwh: number;
  export_kwh: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface BillEstimateResult {
  today: DayBillEstimate;
  tomorrow: DayBillEstimate;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HALF_HOUR_MS = 30 * 60 * 1000;

/** Start of a given day in local time, returned as ISO string. */
function dayStartISO(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Align a timestamp up to the next half-hour boundary. */
function alignToNextHalfHour(ms: number): number {
  const remainder = ms % HALF_HOUR_MS;
  return remainder === 0 ? ms : ms + (HALF_HOUR_MS - remainder);
}

/** Format a Date as YYYY-MM-DD in local time. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Round to 2 decimal places (pence or kWh). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

interface PlanSlotRow {
  slot_start: string;
  action: 'charge' | 'discharge' | 'hold';
}

/**
 * Forecast the net cost for a range of half-hour slots.
 *
 * Returns { forecastCost, importKwh, exportKwh, missingRateSlots, hasPV, hasProfile }.
 */
function forecastSlotRange(
  startMs: number,
  endMs: number,
  importRateLookup: Map<number, number>,
  exportRateLookup: Map<number, number>,
  pvLookup: Map<number, number>,
  actionLookup: Map<number, string>,
  maxChargePowerW: number,
  fallbackConsumptionW: number,
  fixedExportRate: number,
) {
  let totalCostPence = 0;
  let totalImportKwh = 0;
  let totalExportKwh = 0;
  let missingRateSlots = 0;
  let hasPV = false;
  let hasProfile = false;
  let totalSlots = 0;

  for (let t = startMs; t < endMs; t += HALF_HOUR_MS) {
    totalSlots += 1;
    const ts = new Date(t);

    // Consumption forecast
    const consumptionW = getForecastedConsumptionW(ts, fallbackConsumptionW);
    if (consumptionW !== fallbackConsumptionW) hasProfile = true;

    // PV forecast
    const pvW = pvLookup.get(t) ?? 0;
    if (pvW > 0) hasPV = true;

    // Battery action
    const action = actionLookup.get(t) ?? 'hold';

    // Net grid calculation (matching computeSOCForecast model)
    let netGridW: number;
    switch (action) {
      case 'charge': {
        // Grid charges battery at full power; PV surplus above consumption
        // offsets grid charging.
        const pvSurplus = Math.max(0, pvW - consumptionW);
        const effectiveChargeFromGrid = Math.max(0, maxChargePowerW - pvSurplus);
        netGridW = consumptionW - pvW + effectiveChargeFromGrid;
        // Simplifies to: consumptionW + maxChargePowerW - pvW when pvSurplus < maxChargePowerW
        // but let's keep it explicit for clarity
        break;
      }
      case 'discharge': {
        // Battery load-follows: covers shortfall between consumption and PV
        if (pvW >= consumptionW) {
          // PV covers everything; surplus exports
          netGridW = consumptionW - pvW; // negative = export
        } else {
          // Battery covers the gap (up to max discharge power)
          const shortfall = consumptionW - pvW;
          const batterySupply = Math.min(shortfall, maxChargePowerW);
          netGridW = shortfall - batterySupply; // remainder from grid
        }
        break;
      }
      default: {
        // hold: grid covers all consumption; PV reduces import or creates export
        // Battery does not discharge (hold prevents it), but PV surplus above
        // consumption charges the battery (handled by SOC model, not billed)
        netGridW = consumptionW - pvW;
        break;
      }
    }

    // Convert to energy for this 30-min slot: kWh = W * 0.5h / 1000
    const importRate = importRateLookup.get(t);
    if (importRate === undefined) {
      missingRateSlots += 1;
      continue; // skip slots without rate data
    }

    if (netGridW > 0) {
      // Importing from grid
      const kwh = (netGridW / 1000) * 0.5;
      totalImportKwh += kwh;
      totalCostPence += kwh * importRate;
    } else if (netGridW < 0) {
      // Exporting to grid
      const kwh = (Math.abs(netGridW) / 1000) * 0.5;
      totalExportKwh += kwh;
      const expRate = exportRateLookup.get(t) ?? fixedExportRate;
      totalCostPence -= kwh * expRate;
    }
  }

  return {
    forecastCost: round2(totalCostPence),
    importKwh: round2(totalImportKwh),
    exportKwh: round2(totalExportKwh),
    missingRateSlots,
    totalSlots,
    hasPV,
    hasProfile,
  };
}

/**
 * Produce a bill estimate for today (actual + forecast) and tomorrow (forecast).
 */
export function getEstimatedBill(): BillEstimateResult {
  const now = new Date();
  const settings = getSettings();

  // --- Time boundaries (local) ---
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterStart = new Date(tomorrowStart);
  dayAfterStart.setDate(dayAfterStart.getDate() + 1);

  const todayDate = localDateString(todayStart);
  const tomorrowDate = localDateString(tomorrowStart);

  // --- Settings ---
  const fallbackW = parseFloat(settings.estimated_consumption_w) || 500;
  const maxChargePowerW = (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000;
  const fixedExportRate = parseFloat(settings.export_rate) || 0;

  // --- Gather data covering both days ---
  const fromISO = dayStartISO(todayStart);
  const toISO = dayAfterStart.toISOString();

  const importRates = getStoredImportRates(fromISO, toISO);
  const exportRates = getStoredExportRates(fromISO, toISO);
  const pvForecasts = getStoredPVForecast(now.toISOString(), toISO);

  // Planned battery actions
  let planSlots: PlanSlotRow[] = [];
  try {
    const db = getDb();
    planSlots = db.prepare(`
      SELECT slot_start, action FROM plan_slots
      WHERE (status = 'planned' OR status = 'active')
        AND slot_start >= ? AND slot_end <= ?
    `).all(fromISO, toISO) as PlanSlotRow[];
  } catch { /* DB not ready */ }

  // --- Build lookup maps (keyed by epoch ms) ---
  const importRateLookup = new Map<number, number>();
  for (const r of importRates) {
    importRateLookup.set(new Date(r.valid_from).getTime(), r.price_inc_vat);
  }

  const exportRateLookup = new Map<number, number>();
  for (const r of exportRates) {
    exportRateLookup.set(new Date(r.valid_from).getTime(), r.price_inc_vat);
  }

  const pvLookup = new Map<number, number>();
  for (const f of pvForecasts) {
    pvLookup.set(new Date(f.valid_from).getTime(), f.pv_estimate_w);
  }

  const actionLookup = new Map<number, string>();
  for (const s of planSlots) {
    actionLookup.set(new Date(s.slot_start).getTime(), s.action);
  }

  // --- Today: actual portion from readings ---
  const pnl = getDailyPnL('today');
  const todayPnL = pnl.daily.find((d) => d.date === todayDate);
  const actualCost = todayPnL?.net_cost ?? 0;
  const actualImportKwh = todayPnL?.import_kwh ?? 0;
  const actualExportKwh = todayPnL?.export_kwh ?? 0;

  // Find where forecast should start (after last reading)
  let forecastStartMs = alignToNextHalfHour(now.getTime());
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT MAX(timestamp) as last_ts FROM readings WHERE timestamp >= ?',
    ).get(fromISO) as { last_ts: string | null } | undefined;
    if (row?.last_ts) {
      const lastReadingMs = new Date(row.last_ts).getTime();
      forecastStartMs = alignToNextHalfHour(lastReadingMs);
    }
  } catch { /* use now-based fallback */ }

  // --- Today: forecast remaining slots ---
  const todayEndMs = tomorrowStart.getTime();
  const todayForecast = forecastSlotRange(
    forecastStartMs, todayEndMs,
    importRateLookup, exportRateLookup, pvLookup, actionLookup,
    maxChargePowerW, fallbackW, fixedExportRate,
  );

  // --- Tomorrow: full day forecast ---
  const tomorrowForecast = forecastSlotRange(
    tomorrowStart.getTime(), dayAfterStart.getTime(),
    importRateLookup, exportRateLookup, pvLookup, actionLookup,
    maxChargePowerW, fallbackW, fixedExportRate,
  );

  // --- Confidence ---
  function confidence(
    f: ReturnType<typeof forecastSlotRange>,
  ): 'high' | 'medium' | 'low' {
    if (f.totalSlots > 0 && f.missingRateSlots > f.totalSlots * 0.25) return 'low';
    if (f.hasPV && f.hasProfile) return 'high';
    return 'medium';
  }

  const todayTotalCost = round2(actualCost + todayForecast.forecastCost);
  const todayTotalImport = round2(actualImportKwh + todayForecast.importKwh);
  const todayTotalExport = round2(actualExportKwh + todayForecast.exportKwh);

  return {
    today: {
      date: todayDate,
      actual_cost_pence: round2(actualCost),
      forecast_cost_pence: todayForecast.forecastCost,
      total_cost_pence: todayTotalCost,
      import_kwh: todayTotalImport,
      export_kwh: todayTotalExport,
      confidence: confidence(todayForecast),
    },
    tomorrow: {
      date: tomorrowDate,
      actual_cost_pence: 0,
      forecast_cost_pence: tomorrowForecast.forecastCost,
      total_cost_pence: tomorrowForecast.forecastCost,
      import_kwh: tomorrowForecast.importKwh,
      export_kwh: tomorrowForecast.exportKwh,
      confidence: confidence(tomorrowForecast),
    },
    generated_at: now.toISOString(),
  };
}
