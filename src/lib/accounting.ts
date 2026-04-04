import { getDb } from './db';
import { backfillActualValues } from './db/schedule-repository';
import { periodToISO, wattSamplesToKwh } from './analytics';

// --- Battery Profit Tracking ---

export interface BatteryProfitDayData {
  date: string;
  charge_cost: number;
  discharge_revenue: number;
  net_profit: number;
  expected_charge_cost: number;
  expected_discharge_revenue: number;
  slot_count: number;
}

export interface BatteryProfitSummary {
  total_charge_cost: number;
  total_discharge_revenue: number;
  total_net_profit: number;
  total_expected_charge_cost: number;
  total_expected_discharge_revenue: number;
  variance: number;
  completed_slot_count: number;
}

interface BatteryProfitRow {
  date: string;
  charge_actual: number;
  discharge_actual: number;
  charge_expected: number;
  discharge_expected: number;
  slot_count: number;
}

export function getBatteryProfitData(period: string) {
  // Backfill any completed slots that don't yet have actual_value calculated
  // (e.g. slots completed before the actual_value column was added).
  // This is a no-op once all rows are filled.
  backfillActualValues();

  const from = periodToISO(period);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN action = 'charge' THEN COALESCE(actual_value, 0) ELSE 0 END) as charge_actual,
      SUM(CASE WHEN action = 'discharge' THEN COALESCE(actual_value, 0) ELSE 0 END) as discharge_actual,
      SUM(CASE WHEN action = 'charge' THEN COALESCE(expected_value, 0) ELSE 0 END) as charge_expected,
      SUM(CASE WHEN action = 'discharge' THEN COALESCE(expected_value, 0) ELSE 0 END) as discharge_expected,
      COUNT(*) as slot_count
    FROM plan_slots
    WHERE status = 'completed' AND date >= ?
      AND (actual_value IS NOT NULL OR expected_value IS NOT NULL)
    GROUP BY date
    ORDER BY date ASC
  `).all(from) as BatteryProfitRow[];

  let totalChargeCost = 0;
  let totalDischargeRevenue = 0;
  let totalExpChargeCost = 0;
  let totalExpDischargeRevenue = 0;
  let totalSlots = 0;

  const daily: BatteryProfitDayData[] = rows.map((row) => {
    const chargeCost = Math.round(row.charge_actual * 100) / 100;
    const dischargeRevenue = Math.round(row.discharge_actual * 100) / 100;
    const expCharge = Math.round(row.charge_expected * 100) / 100;
    const expDischarge = Math.round(row.discharge_expected * 100) / 100;

    totalChargeCost += chargeCost;
    totalDischargeRevenue += dischargeRevenue;
    totalExpChargeCost += expCharge;
    totalExpDischargeRevenue += expDischarge;
    totalSlots += row.slot_count;

    return {
      date: row.date,
      charge_cost: chargeCost,
      discharge_revenue: dischargeRevenue,
      net_profit: Math.round((dischargeRevenue + chargeCost) * 100) / 100,
      expected_charge_cost: expCharge,
      expected_discharge_revenue: expDischarge,
      slot_count: row.slot_count,
    };
  });

  const actualNet = totalDischargeRevenue + totalChargeCost;
  const expectedNet = totalExpDischargeRevenue + totalExpChargeCost;

  const summary: BatteryProfitSummary = {
    total_charge_cost: Math.round(totalChargeCost * 100) / 100,
    total_discharge_revenue: Math.round(totalDischargeRevenue * 100) / 100,
    total_net_profit: Math.round(actualNet * 100) / 100,
    total_expected_charge_cost: Math.round(totalExpChargeCost * 100) / 100,
    total_expected_discharge_revenue: Math.round(totalExpDischargeRevenue * 100) / 100,
    variance: Math.round((actualNet - expectedNet) * 100) / 100,
    completed_slot_count: totalSlots,
  };

  return { summary, daily };
}

// --- Daily PnL ---

export interface PnLDayData {
  date: string;
  import_kwh: number;
  import_cost: number;
  export_kwh: number;
  export_revenue: number;
  net_cost: number;
}

export interface PnLSummary {
  total_import_kwh: number;
  total_import_cost: number;
  total_export_kwh: number;
  total_export_revenue: number;
  total_net_cost: number;
}

interface PnLRow {
  date: string;
  import_w_sum: number;
  export_w_sum: number;
  sample_count: number;
  avg_import_price: number | null;
  avg_export_price: number | null;
}

/**
 * Calculate daily profit and loss from readings joined with import
 * and export rates. When no export rates exist (user doesn't get paid
 * for export) export_revenue will be 0 for every day.
 */
export function getDailyPnL(period: string) {
  const from = periodToISO(period);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date(r.timestamp) as date,
      SUM(CASE WHEN r.grid_power > 0 THEN r.grid_power ELSE 0 END) as import_w_sum,
      SUM(CASE WHEN r.grid_power < 0 THEN ABS(r.grid_power) ELSE 0 END) as export_w_sum,
      COUNT(*) as sample_count,
      (
        SELECT AVG(ir.price_inc_vat)
        FROM rates ir
        WHERE date(ir.valid_from) = date(r.timestamp)
      ) as avg_import_price,
      (
        SELECT AVG(er.price_inc_vat)
        FROM export_rates er
        WHERE date(er.valid_from) = date(r.timestamp)
      ) as avg_export_price
    FROM readings r
    WHERE r.timestamp >= ?
    GROUP BY date(r.timestamp)
    ORDER BY date ASC
  `).all(from) as PnLRow[];

  let totalImport = 0;
  let totalImportCost = 0;
  let totalExport = 0;
  let totalExportRevenue = 0;

  const daily: PnLDayData[] = rows.map((row) => {
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const exportKwh = wattSamplesToKwh(row.export_w_sum, row.sample_count);

    // Cost in pence: kWh × p/kWh
    const importPrice = row.avg_import_price ?? 0;
    const exportPrice = row.avg_export_price ?? 0;
    const importCost = Math.round(importKwh * importPrice * 100) / 100;
    const exportRevenue = Math.round(exportKwh * exportPrice * 100) / 100;

    totalImport += importKwh;
    totalImportCost += importCost;
    totalExport += exportKwh;
    totalExportRevenue += exportRevenue;

    return {
      date: row.date,
      import_kwh: Math.round(importKwh * 100) / 100,
      import_cost: importCost,
      export_kwh: Math.round(exportKwh * 100) / 100,
      export_revenue: exportRevenue,
      net_cost: Math.round((importCost - exportRevenue) * 100) / 100,
    };
  });

  const summary: PnLSummary = {
    total_import_kwh: Math.round(totalImport * 100) / 100,
    total_import_cost: Math.round(totalImportCost * 100) / 100,
    total_export_kwh: Math.round(totalExport * 100) / 100,
    total_export_revenue: Math.round(totalExportRevenue * 100) / 100,
    total_net_cost: Math.round((totalImportCost - totalExportRevenue) * 100) / 100,
  };

  return { summary, daily };
}
