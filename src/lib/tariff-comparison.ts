import { getDb } from './db';
import { periodToISO, wattSamplesToKwh } from './analytics';
import { getTariffDefinition, type TariffType } from './tariffs/definitions';
import { generateSyntheticRates } from './tariffs/rate-generator';
import { getSettings, type AppSettings } from './config';

export interface ComparisonDayData {
  date: string;
  actual_import_cost: number;
  hypothetical_import_cost: number;
  actual_export_revenue: number;
  hypothetical_export_revenue: number;
  actual_net: number;
  hypothetical_net: number;
  difference: number;
}

export interface ComparisonSummary {
  total_actual_net: number;
  total_hypothetical_net: number;
  total_difference: number;
  percentage_difference: number;
}

interface DailyReadingRow {
  date: string;
  import_w_sum: number;
  export_w_sum: number;
  sample_count: number;
  avg_import_price: number | null;
  avg_export_price: number | null;
}

/**
 * Replay historical consumption against a hypothetical tariff to
 * calculate "what you would have paid".
 */
export function runTariffComparison(
  period: string,
  targetTariffType: TariffType,
  customRates?: { offpeak?: string; peak?: string; standard?: string; export?: string },
) {
  const from = periodToISO(period);
  const db = getDb();
  const settings = getSettings();

  // Build hypothetical settings for rate generation
  const hypotheticalSettings: AppSettings = {
    ...settings,
    tariff_type: targetTariffType,
    ...(customRates?.offpeak ? { tariff_offpeak_rate: customRates.offpeak } : {}),
    ...(customRates?.peak ? { tariff_peak_rate: customRates.peak } : {}),
    ...(customRates?.standard ? { tariff_standard_rate: customRates.standard } : {}),
  };

  const hypotheticalExportRate = parseFloat(customRates?.export ?? settings.export_rate) || 0;

  // Get actual daily usage with actual prices
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
  `).all(from) as DailyReadingRow[];

  const tariffDef = getTariffDefinition(targetTariffType);
  let totalActualNet = 0;
  let totalHypotheticalNet = 0;

  const daily: ComparisonDayData[] = rows.map((row) => {
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const exportKwh = wattSamplesToKwh(row.export_w_sum, row.sample_count);

    // Actual costs
    const actualImportCost = importKwh * (row.avg_import_price ?? 0);
    const actualExportRevenue = exportKwh * (row.avg_export_price ?? 0);
    const actualNet = actualImportCost - actualExportRevenue;

    // Hypothetical costs
    let hypotheticalAvgPrice: number;
    if (tariffDef.usesApiRates) {
      // For Agile comparison, use stored Agile rates
      hypotheticalAvgPrice = row.avg_import_price ?? 0;
    } else {
      // For fixed tariffs, generate synthetic rates for the day and average them
      const dayStart = new Date(row.date + 'T00:00:00Z');
      const dayEnd = new Date(row.date + 'T23:59:59Z');
      const syntheticRates = generateSyntheticRates(
        tariffDef,
        hypotheticalSettings,
        dayStart.toISOString(),
        dayEnd.toISOString(),
      );
      hypotheticalAvgPrice = syntheticRates.length > 0
        ? syntheticRates.reduce((sum, r) => sum + r.price_inc_vat, 0) / syntheticRates.length
        : 0;
    }

    const hypotheticalImportCost = importKwh * hypotheticalAvgPrice;
    const hypotheticalExportRevenue = exportKwh * hypotheticalExportRate;
    const hypotheticalNet = hypotheticalImportCost - hypotheticalExportRevenue;

    totalActualNet += actualNet;
    totalHypotheticalNet += hypotheticalNet;

    return {
      date: row.date,
      actual_import_cost: round2(actualImportCost),
      hypothetical_import_cost: round2(hypotheticalImportCost),
      actual_export_revenue: round2(actualExportRevenue),
      hypothetical_export_revenue: round2(hypotheticalExportRevenue),
      actual_net: round2(actualNet),
      hypothetical_net: round2(hypotheticalNet),
      difference: round2(hypotheticalNet - actualNet),
    };
  });

  const summary: ComparisonSummary = {
    total_actual_net: round2(totalActualNet),
    total_hypothetical_net: round2(totalHypotheticalNet),
    total_difference: round2(totalHypotheticalNet - totalActualNet),
    percentage_difference: totalActualNet !== 0
      ? round2(((totalHypotheticalNet - totalActualNet) / Math.abs(totalActualNet)) * 100)
      : 0,
  };

  return { summary, daily };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
