import { getDb } from './db';
import { periodToISO, wattSamplesToKwh } from './analytics';
import { simulatePassiveBattery, type PassiveBatteryConfig } from './passive-battery';

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

export function getAttributionData(period: string) {
  const from = periodToISO(period);
  const db = getDb();

  // Baseline (no solar, no battery): each half-hour's load would be imported
  // at whatever the user's tariff charged at that moment. We integrate
  // load_power × import_rate the same way we integrate actual grid_power ×
  // import_rate for actual cost — symmetrical pricing, so the delta isolates
  // the hardware/scheduling effect.
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
    WHERE r.timestamp >= ?
    GROUP BY date(r.timestamp)
    ORDER BY date ASC
  `).all(from) as AttributionRow[];

  const passive = simulatePassiveBattery(period);
  const passiveByDate = new Map(passive.daily.map((d) => [d.date, d]));

  const daily: AttributionDay[] = rows.map((row) => {
    const loadKwh = wattSamplesToKwh(row.load_w_sum, row.sample_count);
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const exportKwh = wattSamplesToKwh(row.export_w_sum, row.sample_count);
    const dtHours = row.sample_count > 0 ? 86400 / row.sample_count / 3600 : 0;
    const importCost = round2((row.import_cost_w_price * dtHours) / 1000);
    const exportRevenue = round2((row.export_revenue_w_price * dtHours) / 1000);
    const baseline = round2((row.baseline_cost_w_price * dtHours) / 1000);

    const actual = round2(importCost - exportRevenue);
    const pass = passiveByDate.get(row.date);
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

  const sum = <K extends keyof AttributionDay>(key: K) =>
    daily.reduce((acc, d) => acc + (d[key] as number), 0);

  const totalLoad = sum('load_kwh');
  const totalImport = sum('import_kwh');
  const totalExport = sum('export_kwh');
  const baselineTotal = round2(sum('baseline_cost'));
  const passiveTotal = round2(sum('passive_cost'));
  const actualTotal = round2(sum('actual_cost'));

  // Effective average rate the user pays on imports under their current
  // tariff, for the load they actually ran. Useful as context in the UI
  // ("your tariff averaged Xp/kWh on your consumption pattern this week").
  let totalLoadWithRateWeighted = 0;
  let totalLoadWithRate = 0;
  for (const row of rows) {
    const dtHours = row.sample_count > 0 ? 86400 / row.sample_count / 3600 : 0;
    totalLoadWithRateWeighted += (row.baseline_cost_w_price * dtHours) / 1000;
    totalLoadWithRate += ((row.load_w_sum_with_rate ?? 0) * dtHours) / 1000;
  }
  const avgImportRate = totalLoadWithRate > 0
    ? Math.round((totalLoadWithRateWeighted / totalLoadWithRate) * 10) / 10
    : 0;

  const summary: AttributionSummary = {
    load_kwh: round2(totalLoad),
    import_kwh: round2(totalImport),
    export_kwh: round2(totalExport),
    passive_import_kwh: passive.summary.import_kwh,
    passive_export_kwh: passive.summary.export_kwh,
    avg_import_rate: avgImportRate,
    baseline_cost: baselineTotal,
    passive_cost: passiveTotal,
    actual_cost: actualTotal,
    hardware_saving: round2(baselineTotal - passiveTotal),
    scheduling_saving: round2(passiveTotal - actualTotal),
    total_saving: round2(baselineTotal - actualTotal),
    passive_config: {
      capacity_kwh: passive.summary.capacity_kwh,
      min_soc_pct: passive.summary.min_soc_pct,
      max_power_kw: passive.summary.max_power_kw,
      round_trip_efficiency: passive.summary.round_trip_efficiency,
      starting_soc_pct: passive.summary.starting_soc_pct,
    },
  };

  return { summary, daily };
}
