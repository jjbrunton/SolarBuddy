import { getDb } from '@/lib/db';
import { periodToISO, wattSamplesToKwh, FLAT_RATE_PENCE } from '@/lib/analytics';
import {
  fetchAndStoreCarbonIntensity,
  getStoredCarbonIntensity,
  isCacheStale,
} from '@/lib/carbon';

/* ─── Savings ─── */

interface SavingsDailyRow {
  date: string;
  import_w_sum: number;
  sample_count: number;
  weighted_cost_sum: number;
  max_rate: number;
}

export interface SavingsDayData {
  date: string;
  import_kwh: number;
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings: number;
}

export interface SavingsSummary {
  total_import_kwh: number;
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings_vs_flat: number;
  savings_vs_peak: number;
}

export function getSavingsData(period: string) {
  const from = periodToISO(period);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date(r.timestamp) as date,
      SUM(CASE WHEN r.grid_power > 0 THEN r.grid_power ELSE 0 END) as import_w_sum,
      COUNT(*) as sample_count,
      SUM(CASE WHEN r.grid_power > 0 AND rt.price_inc_vat IS NOT NULL
        THEN r.grid_power * rt.price_inc_vat
        ELSE 0 END) as weighted_cost_sum,
      COALESCE(MAX(rt.price_inc_vat), 0) as max_rate
    FROM readings r
    LEFT JOIN rates rt
      ON r.timestamp >= rt.valid_from AND r.timestamp < rt.valid_to
    WHERE r.timestamp >= ?
    GROUP BY date(r.timestamp)
    ORDER BY date ASC
  `).all(from) as SavingsDailyRow[];

  let totalImportKwh = 0;
  let totalActualCost = 0;
  let totalFlatCost = 0;
  let totalPeakCost = 0;

  const daily: SavingsDayData[] = rows.map((row) => {
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const dtHours = row.sample_count > 0 ? 86400 / row.sample_count / 3600 : 0;
    const actualCost = Math.round(row.weighted_cost_sum * dtHours / 1000 * 100) / 100;
    const flatCost = Math.round(importKwh * FLAT_RATE_PENCE * 100) / 100;
    const peakCost = Math.round(importKwh * row.max_rate * 100) / 100;
    const savings = Math.round((flatCost - actualCost) * 100) / 100;

    totalImportKwh += importKwh;
    totalActualCost += actualCost;
    totalFlatCost += flatCost;
    totalPeakCost += peakCost;

    return { date: row.date, import_kwh: importKwh, actual_cost: actualCost, flat_rate_cost: flatCost, peak_rate_cost: peakCost, savings };
  });

  const summary: SavingsSummary = {
    total_import_kwh: Math.round(totalImportKwh * 100) / 100,
    actual_cost: Math.round(totalActualCost * 100) / 100,
    flat_rate_cost: Math.round(totalFlatCost * 100) / 100,
    peak_rate_cost: Math.round(totalPeakCost * 100) / 100,
    savings_vs_flat: Math.round((totalFlatCost - totalActualCost) * 100) / 100,
    savings_vs_peak: Math.round((totalPeakCost - totalActualCost) * 100) / 100,
  };

  return { summary, daily };
}

/* ─── Battery Health ─── */

interface BatteryDailyRow {
  date: string;
  min_soc: number;
  max_soc: number;
}

export interface BatteryDayData {
  date: string;
  min_soc: number;
  max_soc: number;
  depth_of_discharge: number;
  equivalent_cycles: number;
  cumulative_cycles: number;
}

export interface BatterySummary {
  total_equivalent_cycles: number;
  avg_daily_cycles: number;
  avg_depth_of_discharge: number;
  max_depth_of_discharge: number;
  avg_min_soc: number;
}

export function getBatteryData(period: string) {
  const from = periodToISO(period);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date(timestamp) as date,
      MIN(battery_soc) as min_soc,
      MAX(battery_soc) as max_soc
    FROM readings
    WHERE timestamp >= ? AND battery_soc IS NOT NULL
    GROUP BY date(timestamp)
    ORDER BY date ASC
  `).all(from) as BatteryDailyRow[];

  let totalCycles = 0;
  let dodSum = 0;
  let maxDod = 0;
  let minSocSum = 0;

  const daily: BatteryDayData[] = rows.map((row) => {
    const dod = Math.round((row.max_soc - row.min_soc) * 10) / 10;
    const cycles = Math.round(dod / 100 * 1000) / 1000;
    totalCycles += cycles;
    dodSum += dod;
    if (dod > maxDod) maxDod = dod;
    minSocSum += row.min_soc;

    return {
      date: row.date,
      min_soc: Math.round(row.min_soc * 10) / 10,
      max_soc: Math.round(row.max_soc * 10) / 10,
      depth_of_discharge: dod,
      equivalent_cycles: Math.round(cycles * 1000) / 1000,
      cumulative_cycles: Math.round(totalCycles * 100) / 100,
    };
  });

  const dayCount = daily.length || 1;
  const summary: BatterySummary = {
    total_equivalent_cycles: Math.round(totalCycles * 100) / 100,
    avg_daily_cycles: Math.round(totalCycles / dayCount * 1000) / 1000,
    avg_depth_of_discharge: Math.round(dodSum / dayCount * 10) / 10,
    max_depth_of_discharge: maxDod,
    avg_min_soc: Math.round(minSocSum / dayCount * 10) / 10,
  };

  return { summary, daily };
}

/* ─── Carbon Intensity ─── */

export interface CarbonSlotData {
  from: string;
  to: string;
  forecast: number | null;
  actual: number | null;
  index: string | null;
  solar_kwh: number;
  carbon_saved_g: number;
}

export interface CarbonSummary {
  current_intensity: number | null;
  current_index: string | null;
  avg_intensity: number | null;
  carbon_saved_g: number;
  carbon_saved_kg: number;
}

export async function getCarbonData(period: string) {
  const from = periodToISO(period);
  const to = new Date().toISOString();

  if (isCacheStale(from, to)) {
    try {
      await fetchAndStoreCarbonIntensity(from, to);
    } catch (err) {
      console.error('[Carbon] Failed to fetch intensity data:', err);
    }
  }

  const carbonData = getStoredCarbonIntensity(from, to);

  const db = getDb();
  const solarRows = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:', timestamp) ||
        CASE WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '00' ELSE '30' END ||
        ':00.000Z' as half_hour,
      SUM(COALESCE(pv_power, 0)) as pv_sum,
      COUNT(*) as sample_count
    FROM readings
    WHERE timestamp >= ?
    GROUP BY half_hour
    ORDER BY half_hour ASC
  `).all(from) as { half_hour: string; pv_sum: number; sample_count: number }[];

  const solarBySlot = new Map<string, number>();
  for (const row of solarRows) {
    const kwh = wattSamplesToKwh(row.pv_sum, row.sample_count, 1800);
    solarBySlot.set(row.half_hour, kwh);
  }

  let totalCarbonSaved = 0;
  let intensitySum = 0;
  let intensityCount = 0;

  const halfhourly: CarbonSlotData[] = carbonData.map((c: { period_from: string; period_to: string; intensity_forecast: number | null; intensity_actual: number | null; intensity_index: string | null }) => {
    const forecast = c.intensity_forecast ?? 0;
    const solarKwh = solarBySlot.get(c.period_from) ?? 0;
    const carbonSaved = Math.round(solarKwh * forecast * 100) / 100;

    totalCarbonSaved += carbonSaved;
    if (c.intensity_forecast !== null) {
      intensitySum += c.intensity_forecast;
      intensityCount++;
    }

    return {
      from: c.period_from,
      to: c.period_to,
      forecast: c.intensity_forecast,
      actual: c.intensity_actual,
      index: c.intensity_index,
      solar_kwh: solarKwh,
      carbon_saved_g: carbonSaved,
    };
  });

  const now = new Date();
  const current = halfhourly.find((h) => {
    const f = new Date(h.from);
    const t = new Date(h.to);
    return now >= f && now < t;
  });

  const summary: CarbonSummary = {
    current_intensity: current?.forecast ?? null,
    current_index: current?.index ?? null,
    avg_intensity: intensityCount > 0 ? Math.round(intensitySum / intensityCount) : null,
    carbon_saved_g: Math.round(totalCarbonSaved),
    carbon_saved_kg: Math.round(totalCarbonSaved / 10) / 100,
  };

  return { summary, halfhourly };
}

/* ─── Energy Flow ─── */

interface EnergyDailyRow {
  date: string;
  import_w_sum: number;
  export_w_sum: number;
  generation_w_sum: number;
  consumption_w_sum: number;
  sample_count: number;
}

export interface EnergyDayData {
  date: string;
  import_kwh: number;
  export_kwh: number;
  generation_kwh: number;
  consumption_kwh: number;
  self_sufficiency: number;
}

export interface EnergySummary {
  total_import_kwh: number;
  total_export_kwh: number;
  total_generation_kwh: number;
  total_consumption_kwh: number;
  avg_self_sufficiency: number;
}

export function getEnergyData(period: string) {
  const from = periodToISO(period);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      date(timestamp) as date,
      SUM(CASE WHEN grid_power > 0 THEN grid_power ELSE 0 END) as import_w_sum,
      SUM(CASE WHEN grid_power < 0 THEN ABS(grid_power) ELSE 0 END) as export_w_sum,
      SUM(COALESCE(pv_power, 0)) as generation_w_sum,
      SUM(COALESCE(load_power, 0)) as consumption_w_sum,
      COUNT(*) as sample_count
    FROM readings
    WHERE timestamp >= ?
    GROUP BY date(timestamp)
    ORDER BY date ASC
  `).all(from) as EnergyDailyRow[];

  let totalImport = 0;
  let totalExport = 0;
  let totalGeneration = 0;
  let totalConsumption = 0;
  let selfSufficiencySum = 0;

  const daily: EnergyDayData[] = rows.map((row) => {
    const importKwh = wattSamplesToKwh(row.import_w_sum, row.sample_count);
    const exportKwh = wattSamplesToKwh(row.export_w_sum, row.sample_count);
    const generationKwh = wattSamplesToKwh(row.generation_w_sum, row.sample_count);
    const consumptionKwh = wattSamplesToKwh(row.consumption_w_sum, row.sample_count);
    const selfSufficiency = consumptionKwh > 0
      ? Math.round(Math.max(0, Math.min(100, (1 - importKwh / consumptionKwh) * 100)) * 10) / 10
      : generationKwh > 0 ? 100 : 0;

    totalImport += importKwh;
    totalExport += exportKwh;
    totalGeneration += generationKwh;
    totalConsumption += consumptionKwh;
    selfSufficiencySum += selfSufficiency;

    return { date: row.date, import_kwh: importKwh, export_kwh: exportKwh, generation_kwh: generationKwh, consumption_kwh: consumptionKwh, self_sufficiency: selfSufficiency };
  });

  const avgSelfSufficiency = daily.length > 0
    ? Math.round(selfSufficiencySum / daily.length * 10) / 10
    : 0;

  const summary: EnergySummary = {
    total_import_kwh: Math.round(totalImport * 100) / 100,
    total_export_kwh: Math.round(totalExport * 100) / 100,
    total_generation_kwh: Math.round(totalGeneration * 100) / 100,
    total_consumption_kwh: Math.round(totalConsumption * 100) / 100,
    avg_self_sufficiency: avgSelfSufficiency,
  };

  return { summary, daily };
}

/* ─── Rate Trends ─── */

interface DailyAvgRow {
  date: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  negative_slots: number;
}

interface TimeSlotRow {
  time_slot: string;
  avg_price: number;
  min_price: number;
  max_price: number;
}

interface TodayRateRow {
  time_slot: string;
  price: number;
}

export interface RateTimeSlot {
  time_slot: string;
  today_price: number | null;
  avg_price: number;
  min_price: number;
  max_price: number;
}

export interface RateDailyAvg {
  date: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  negative_slots: number;
}

export function getRatesCompareData(compare: string) {
  const from = periodToISO(compare);
  const todayStr = new Date().toISOString().slice(0, 10);
  const db = getDb();

  const dailyAverages = db.prepare(`
    SELECT
      date(valid_from) as date,
      ROUND(MIN(price_inc_vat), 2) as min_price,
      ROUND(MAX(price_inc_vat), 2) as max_price,
      ROUND(AVG(price_inc_vat), 2) as avg_price,
      SUM(CASE WHEN price_inc_vat < 0 THEN 1 ELSE 0 END) as negative_slots
    FROM rates
    WHERE valid_from >= ?
    GROUP BY date(valid_from)
    ORDER BY date ASC
  `).all(from) as DailyAvgRow[];

  const timeOfDay = db.prepare(`
    SELECT
      strftime('%H:%M', valid_from) as time_slot,
      ROUND(AVG(price_inc_vat), 2) as avg_price,
      ROUND(MIN(price_inc_vat), 2) as min_price,
      ROUND(MAX(price_inc_vat), 2) as max_price
    FROM rates
    WHERE valid_from >= ? AND date(valid_from) < ?
    GROUP BY strftime('%H:%M', valid_from)
    ORDER BY time_slot ASC
  `).all(from, todayStr) as TimeSlotRow[];

  const todayRates = db.prepare(`
    SELECT
      strftime('%H:%M', valid_from) as time_slot,
      ROUND(price_inc_vat, 2) as price
    FROM rates
    WHERE date(valid_from) = ?
    ORDER BY valid_from ASC
  `).all(todayStr) as TodayRateRow[];

  const todayPrices = todayRates.map((r) => r.price);
  const todayAvg = todayPrices.length > 0
    ? Math.round(todayPrices.reduce((a, b) => a + b, 0) / todayPrices.length * 100) / 100
    : null;

  const historicalPrices = dailyAverages
    .filter((d) => d.date < todayStr)
    .map((d) => d.avg_price);
  const historicalAvg = historicalPrices.length > 0
    ? Math.round(historicalPrices.reduce((a, b) => a + b, 0) / historicalPrices.length * 100) / 100
    : null;

  const priceChangePct = todayAvg !== null && historicalAvg !== null && historicalAvg !== 0
    ? Math.round((todayAvg - historicalAvg) / Math.abs(historicalAvg) * 100 * 10) / 10
    : null;

  const todayMap = new Map(todayRates.map((r) => [r.time_slot, r.price]));
  const time_of_day: RateTimeSlot[] = timeOfDay.map((slot) => ({
    time_slot: slot.time_slot,
    today_price: todayMap.get(slot.time_slot) ?? null,
    avg_price: slot.avg_price,
    min_price: slot.min_price,
    max_price: slot.max_price,
  }));

  return {
    today: {
      avg_price: todayAvg,
      min_price: todayPrices.length > 0 ? Math.min(...todayPrices) : null,
      max_price: todayPrices.length > 0 ? Math.max(...todayPrices) : null,
    },
    comparison: {
      avg_price: historicalAvg,
      price_change_pct: priceChangePct,
    },
    daily_averages: dailyAverages as RateDailyAvg[],
    time_of_day,
  };
}
