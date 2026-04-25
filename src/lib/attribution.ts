import { getDb } from './db';
import { periodToISO, wattSamplesToKwh } from './analytics';
import { getSettings } from './config';
import {
  simulatePassiveBatteryRange,
  calibrateRoundTripEfficiency,
  type PassiveBatteryConfig,
} from './passive-battery';

// Attribution decomposes your actual cost into three comparable scenarios
// (PredBat's "base" pattern):
//
//   baseline_cost  = load_kwh priced against your CURRENT tariff rates
//                    (no solar, no battery, same tariff you're on now)
//   passive_cost   = cost of a passive self-use-only battery (from simulation)
//                    (solar + battery, no smart scheduling)
//   actual_cost    = what you actually paid
//
// From these, two additive savings components:
//
//   hardware_saving   = baseline_cost − passive_cost    (solar + battery value)
//   scheduling_saving = passive_cost − actual_cost      (SolarBuddy's value)
//   total_saving      = baseline_cost − actual_cost = hardware + scheduling
//
// Each can be negative: scheduling can drag the bill up on a bad plan day,
// and hardware value can be tiny or negative in a week with no sun.
//
// Priced throughout at the user's real half-hour import rates so that the
// comparison isolates the effect of the hardware/scheduling rather than
// bundling in the effect of switching tariffs.

export interface AttributionDay {
  date: string;
  load_kwh: number;
  import_kwh: number;
  export_kwh: number;
  passive_import_kwh: number;
  passive_export_kwh: number;
  baseline_cost: number;
  passive_cost: number;
  actual_cost: number;
  hardware_saving: number;
  scheduling_saving: number;
  total_saving: number;
}

export interface AttributionSummary {
  load_kwh: number;
  import_kwh: number;
  export_kwh: number;
  passive_import_kwh: number;
  passive_export_kwh: number;
  avg_import_rate: number;
  baseline_cost: number;
  passive_cost: number;
  actual_cost: number;
  hardware_saving: number;
  scheduling_saving: number;
  total_saving: number;
  passive_config: PassiveBatteryConfig;
}

interface AttributionRow {
  date: string;
  load_w_sum: number;
  import_w_sum: number;
  export_w_sum: number;
  sample_count: number;
  import_cost_w_price: number;
  export_revenue_w_price: number;
  baseline_cost_w_price: number;
  load_w_sum_with_rate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Live-compute the attribution rows for a date range, hitting the readings
// table directly. Previously inlined inside getAttributionData; extracted so
// it can drive both the cache-fill path (one date at a time) and the live
// path for the in-progress current day.
function computeAttributionRowsForRange(
  fromISO: string,
  toExclusiveISO: string | null,
  passiveDailyCost: Map<string, { cost: number; import_kwh: number; export_kwh: number }>,
): AttributionDay[] {
  const db = getDb();
  const params: unknown[] = [fromISO];
  let whereClause = 'WHERE r.timestamp >= ?';
  if (toExclusiveISO != null) {
    whereClause += ' AND r.timestamp < ?';
    params.push(toExclusiveISO);
  }

  const rows = db.prepare(`
    SELECT
      date(r.timestamp) as date,
      SUM(COALESCE(r.load_power, 0)) as load_w_sum,
      SUM(CASE WHEN r.grid_power > 0 THEN r.grid_power ELSE 0 END) as import_w_sum,
      SUM(CASE WHEN r.grid_power < 0 THEN ABS(r.grid_power) ELSE 0 END) as export_w_sum,
      COUNT(*) as sample_count,
      SUM(CASE WHEN r.grid_power > 0 AND ir.price_inc_vat IS NOT NULL
        THEN r.grid_power * ir.price_inc_vat ELSE 0 END) as import_cost_w_price,
      SUM(CASE WHEN r.grid_power < 0 AND er.price_inc_vat IS NOT NULL
        THEN ABS(r.grid_power) * er.price_inc_vat ELSE 0 END) as export_revenue_w_price,
      SUM(CASE WHEN COALESCE(r.load_power, 0) > 0 AND ir.price_inc_vat IS NOT NULL
        THEN r.load_power * ir.price_inc_vat ELSE 0 END) as baseline_cost_w_price,
      SUM(CASE WHEN COALESCE(r.load_power, 0) > 0 AND ir.price_inc_vat IS NOT NULL
        THEN r.load_power ELSE 0 END) as load_w_sum_with_rate
    FROM readings r
    LEFT JOIN rates ir
      ON r.timestamp >= ir.valid_from AND r.timestamp < ir.valid_to
    LEFT JOIN export_rates er
      ON r.timestamp >= er.valid_from AND r.timestamp < er.valid_to
    ${whereClause}
    GROUP BY date(r.timestamp)
    ORDER BY date ASC
  `).all(...params) as AttributionRow[];

  return rows.map((row) => {
    const loadKwh = wattSamplesToKwh(row.load_w_sum, row.sample_count);
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const exportKwh = wattSamplesToKwh(row.export_w_sum, row.sample_count);
    const dtHours = row.sample_count > 0 ? 86400 / row.sample_count / 3600 : 0;
    const importCost = round2((row.import_cost_w_price * dtHours) / 1000);
    const exportRevenue = round2((row.export_revenue_w_price * dtHours) / 1000);
    const baseline = round2((row.baseline_cost_w_price * dtHours) / 1000);

    const actual = round2(importCost - exportRevenue);
    const pass = passiveDailyCost.get(row.date);
    const passiveCost = pass ? round2(pass.cost) : actual;

    const hardwareSaving = round2(baseline - passiveCost);
    const schedulingSaving = round2(passiveCost - actual);
    const totalSaving = round2(hardwareSaving + schedulingSaving);

    return {
      date: row.date,
      load_kwh: round2(loadKwh),
      import_kwh: round2(importKwh),
      export_kwh: round2(exportKwh),
      passive_import_kwh: pass?.import_kwh ?? 0,
      passive_export_kwh: pass?.export_kwh ?? 0,
      baseline_cost: baseline,
      passive_cost: passiveCost,
      actual_cost: actual,
      hardware_saving: hardwareSaving,
      scheduling_saving: schedulingSaving,
      total_saving: totalSaving,
    };
  });
}

interface CachedAttributionRow extends AttributionDay {
  rte_used: number;
  rte_source: 'calibrated' | 'fallback';
  computed_at: string;
}

function readCachedDays(fromDate: string, toExclusiveDate: string): CachedAttributionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT date, load_kwh, import_kwh, export_kwh, passive_import_kwh, passive_export_kwh,
        baseline_cost, passive_cost, actual_cost, hardware_saving, scheduling_saving, total_saving,
        rte_used, rte_source, computed_at
       FROM attribution_daily_cache
       WHERE date >= ? AND date < ?
       ORDER BY date ASC`,
    )
    .all(fromDate, toExclusiveDate) as CachedAttributionRow[];
}

function upsertCachedDay(
  row: AttributionDay,
  rteUsed: number,
  rteSource: 'calibrated' | 'fallback',
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO attribution_daily_cache (
       date, load_kwh, import_kwh, export_kwh, passive_import_kwh, passive_export_kwh,
       baseline_cost, passive_cost, actual_cost, hardware_saving, scheduling_saving, total_saving,
       rte_used, rte_source, computed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       load_kwh=excluded.load_kwh,
       import_kwh=excluded.import_kwh,
       export_kwh=excluded.export_kwh,
       passive_import_kwh=excluded.passive_import_kwh,
       passive_export_kwh=excluded.passive_export_kwh,
       baseline_cost=excluded.baseline_cost,
       passive_cost=excluded.passive_cost,
       actual_cost=excluded.actual_cost,
       hardware_saving=excluded.hardware_saving,
       scheduling_saving=excluded.scheduling_saving,
       total_saving=excluded.total_saving,
       rte_used=excluded.rte_used,
       rte_source=excluded.rte_source,
       computed_at=excluded.computed_at`,
  ).run(
    row.date,
    row.load_kwh,
    row.import_kwh,
    row.export_kwh,
    row.passive_import_kwh,
    row.passive_export_kwh,
    row.baseline_cost,
    row.passive_cost,
    row.actual_cost,
    row.hardware_saving,
    row.scheduling_saving,
    row.total_saving,
    rteUsed,
    rteSource,
    new Date().toISOString(),
  );
}

// Recompute one specific date and write it to the cache. Idempotent —
// repeated calls overwrite the same row. The passive simulator is run over
// the single day, seeding its SOC from the day's first recorded reading.
export function recomputeAttributionForDate(date: string): AttributionDay | null {
  const fromISO = `${date}T00:00:00.000Z`;
  const toExclusiveISO = `${dateAddDays(date, 1)}T00:00:00.000Z`;

  const passive = simulatePassiveBatteryRange({ fromISO, toExclusiveISO });
  const passiveMap = new Map(passive.daily.map((d) => [d.date, d]));

  const rows = computeAttributionRowsForRange(fromISO, toExclusiveISO, passiveMap);
  const row = rows[0] ?? null;
  if (row) {
    upsertCachedDay(row, passive.summary.round_trip_efficiency, passive.summary.rte_source);
  }
  return row;
}

// Bulk-recompute the trailing N days in one pass. The passive simulator is
// run once over the whole window so its SOC trace stays continuous across
// day boundaries — better than per-day re-seeding when readings are dense.
// Used by the daily cron job and by the manual "Recompute savings" button.
export function recomputeAttributionRange(daysBack = 90): { days_recomputed: number } {
  const today = todayUtcDate();
  const fromDate = dateAddDays(today, -daysBack);
  const fromISO = `${fromDate}T00:00:00.000Z`;
  const toISO = `${today}T00:00:00.000Z`;

  const passive = simulatePassiveBatteryRange({ fromISO, toExclusiveISO: toISO });
  const passiveByDate = new Map(passive.daily.map((d) => [d.date, d]));
  const rows = computeAttributionRowsForRange(fromISO, toISO, passiveByDate);

  for (const row of rows) {
    upsertCachedDay(row, passive.summary.round_trip_efficiency, passive.summary.rte_source);
  }
  return { days_recomputed: rows.length };
}

export function getAttributionData(period: string) {
  // Baseline (no solar, no battery): each half-hour's load would be imported
  // at whatever the user's tariff charged at that moment. We integrate
  // load_power × import_rate the same way we integrate actual grid_power ×
  // import_rate for actual cost — symmetrical pricing, so the delta isolates
  // the hardware/scheduling effect.
  //
  // Read path: serve cached completed days from attribution_daily_cache and
  // run the passive simulator only over the uncached tail (typically just
  // today on a healthy install). Period totals are aggregated from the
  // daily rows so the simulator never needs to scan the whole window.
  const from = periodToISO(period);
  const fromDate = from.slice(0, 10);
  const today = todayUtcDate();

  const cached = readCachedDays(fromDate, today);
  const cachedDates = new Set(cached.map((r) => r.date));

  // Live tail starts at the earliest uncached date in the window — either
  // today (cache fully populated) or further back if the cron has not
  // caught up yet. Running the simulator from there keeps SOC seeded
  // close to reality without re-scanning days we already have.
  let liveFromISO = `${today}T00:00:00.000Z`;
  if (cached.length > 0) {
    // Find the earliest uncached date by walking the requested window day
    // by day. This finds an off-axis missing day (rare) without forcing a
    // full re-scan when the cache is contiguous up to today.
    for (let d = fromDate; d < today; d = dateAddDays(d, 1)) {
      if (!cachedDates.has(d)) {
        liveFromISO = `${d}T00:00:00.000Z`;
        break;
      }
    }
  } else if (fromDate < today) {
    // Empty cache — first load before the cron has run. Fall back to a
    // single live pass over the whole window. Subsequent loads use the
    // cache (filled by the cron at 03:45 or the manual button).
    liveFromISO = from;
  }

  const passive = simulatePassiveBatteryRange({ fromISO: liveFromISO });
  const passiveByDate = new Map(passive.daily.map((d) => [d.date, d]));
  const liveRows = computeAttributionRowsForRange(liveFromISO, null, passiveByDate).filter(
    (r) => !cachedDates.has(r.date),
  );

  const daily: AttributionDay[] = [
    ...cached.map((c) => ({
      date: c.date,
      load_kwh: c.load_kwh,
      import_kwh: c.import_kwh,
      export_kwh: c.export_kwh,
      passive_import_kwh: c.passive_import_kwh,
      passive_export_kwh: c.passive_export_kwh,
      baseline_cost: c.baseline_cost,
      passive_cost: c.passive_cost,
      actual_cost: c.actual_cost,
      hardware_saving: c.hardware_saving,
      scheduling_saving: c.scheduling_saving,
      total_saving: c.total_saving,
    })),
    ...liveRows,
  ].sort((a, b) => a.date.localeCompare(b.date));

  const sum = <K extends keyof AttributionDay>(key: K) =>
    daily.reduce((acc, d) => acc + (d[key] as number), 0);

  const totalLoad = sum('load_kwh');
  const totalImport = sum('import_kwh');
  const totalExport = sum('export_kwh');
  const totalPassiveImport = sum('passive_import_kwh');
  const totalPassiveExport = sum('passive_export_kwh');
  const baselineTotal = round2(sum('baseline_cost'));
  const passiveTotal = round2(sum('passive_cost'));
  const actualTotal = round2(sum('actual_cost'));

  // Effective average rate: derive from the daily rows we already have.
  // baseline_cost / load_kwh per day gives the rate experienced during that
  // day's load; weighting by load_kwh recovers the period average.
  const totalLoadForRate = daily.reduce((acc, d) => acc + (d.load_kwh > 0 ? d.load_kwh : 0), 0);
  const avgImportRate = totalLoadForRate > 0
    ? Math.round((baselineTotal / totalLoadForRate) * 10) / 10
    : 0;

  // passive_config describes the simulation parameters. When the cache is
  // doing the heavy lifting we still surface the live calibration (cheap —
  // same 30-day calibrate query) so the UI can show "calibrated" honestly.
  const settings = getSettings();
  const capacityKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
  const minSocPct = parseFloat(settings.discharge_soc_floor) || 20;
  const maxPowerKw = parseFloat(settings.max_charge_power_kw) || 3.6;
  const calibration = calibrateRoundTripEfficiency(capacityKwh);

  const summary: AttributionSummary = {
    load_kwh: round2(totalLoad),
    import_kwh: round2(totalImport),
    export_kwh: round2(totalExport),
    passive_import_kwh: round2(totalPassiveImport),
    passive_export_kwh: round2(totalPassiveExport),
    avg_import_rate: avgImportRate,
    baseline_cost: baselineTotal,
    passive_cost: passiveTotal,
    actual_cost: actualTotal,
    hardware_saving: round2(baselineTotal - passiveTotal),
    scheduling_saving: round2(passiveTotal - actualTotal),
    total_saving: round2(baselineTotal - actualTotal),
    passive_config: {
      capacity_kwh: capacityKwh,
      min_soc_pct: minSocPct,
      max_power_kw: maxPowerKw,
      round_trip_efficiency: calibration.round_trip_efficiency,
      rte_source: calibration.source,
      starting_soc_pct: passive.summary.starting_soc_pct,
    },
  };

  return { summary, daily };
}
