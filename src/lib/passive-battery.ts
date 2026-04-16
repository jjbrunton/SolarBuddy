import { getDb } from './db';
import { periodToISO } from './analytics';
import { getSettings } from './config';

// Simulate a "passive" battery controller over historical readings:
//   - When PV > load: store surplus in battery (up to capacity + power limits),
//     export the rest.
//   - When PV < load: discharge battery to cover the gap (down to minimum SOC),
//     import the rest.
// No grid-charging, no arbitrage — this is what a dumb self-use-only inverter
// would do. The output is a counterfactual cost that isolates SolarBuddy's
// scheduling value (actual vs passive) from hardware value (passive vs
// standard-tariff baseline). Same pattern as PredBat's `base` scenario.

export interface PassiveBatteryDay {
  date: string;
  import_kwh: number;
  export_kwh: number;
  cost: number;
}

export interface PassiveBatteryConfig {
  capacity_kwh: number;
  min_soc_pct: number;
  max_power_kw: number;
  round_trip_efficiency: number;
  starting_soc_pct: number;
}

export interface PassiveBatterySummary extends PassiveBatteryConfig {
  import_kwh: number;
  export_kwh: number;
  cost: number;
  simulated_seconds: number;
}

interface ReadingRow {
  timestamp: string;
  pv_power: number | null;
  load_power: number | null;
  battery_soc: number | null;
}

interface RateRow {
  valid_from: string;
  price_inc_vat: number;
}

const HALF_HOUR_MS = 30 * 60 * 1000;
// Cap inter-reading gaps so a stretch of missing data doesn't let one sample
// dominate. 5 minutes matches typical sample cadence tolerance.
const MAX_DT_HOURS = 5 / 60;
// Split round-trip losses evenly across charge and discharge legs.
const DEFAULT_ROUND_TRIP_EFFICIENCY = 0.9;

function halfHourStartMs(ts: number): number {
  return Math.floor(ts / HALF_HOUR_MS) * HALF_HOUR_MS;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function simulatePassiveBattery(period: string): {
  daily: PassiveBatteryDay[];
  summary: PassiveBatterySummary;
} {
  const from = periodToISO(period);
  const settings = getSettings();
  const capacityKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
  const minSocPct = parseFloat(settings.discharge_soc_floor) || 20;
  const maxPowerKw = parseFloat(settings.max_charge_power_kw) || 3.6;
  const roundTripEff = DEFAULT_ROUND_TRIP_EFFICIENCY;
  const legEff = Math.sqrt(roundTripEff);

  const minEnergyKwh = (capacityKwh * minSocPct) / 100;
  const db = getDb();

  const readings = db.prepare(`
    SELECT timestamp, pv_power, load_power, battery_soc
    FROM readings
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(from) as ReadingRow[];

  const emptyConfig: PassiveBatteryConfig = {
    capacity_kwh: capacityKwh,
    min_soc_pct: minSocPct,
    max_power_kw: maxPowerKw,
    round_trip_efficiency: roundTripEff,
    starting_soc_pct: 0,
  };

  if (readings.length < 2) {
    return {
      daily: [],
      summary: { ...emptyConfig, import_kwh: 0, export_kwh: 0, cost: 0, simulated_seconds: 0 },
    };
  }

  // Load rates for the window once and index by half-hour bucket.
  const toISO = new Date(Date.now() + 86400000).toISOString();
  const importRates = db
    .prepare('SELECT valid_from, price_inc_vat FROM rates WHERE valid_from >= ? AND valid_from < ?')
    .all(from, toISO) as RateRow[];
  const exportRates = db
    .prepare('SELECT valid_from, price_inc_vat FROM export_rates WHERE valid_from >= ? AND valid_from < ?')
    .all(from, toISO) as RateRow[];

  const importRateMap = new Map<number, number>();
  for (const r of importRates) {
    importRateMap.set(new Date(r.valid_from).getTime(), r.price_inc_vat);
  }
  const exportRateMap = new Map<number, number>();
  for (const r of exportRates) {
    exportRateMap.set(new Date(r.valid_from).getTime(), r.price_inc_vat);
  }

  const startingSocPct = readings[0].battery_soc ?? 50;
  let currentEnergyKwh = Math.max(
    minEnergyKwh,
    Math.min(capacityKwh, (capacityKwh * startingSocPct) / 100),
  );

  const daily = new Map<string, PassiveBatteryDay>();
  let totalSimSeconds = 0;

  for (let i = 0; i < readings.length - 1; i++) {
    const r = readings[i];
    const next = readings[i + 1];
    const ts = new Date(r.timestamp).getTime();
    const tsNext = new Date(next.timestamp).getTime();
    const rawDtHours = (tsNext - ts) / 3600000;
    if (rawDtHours <= 0) continue;
    const dtHours = Math.min(rawDtHours, MAX_DT_HOURS);
    totalSimSeconds += dtHours * 3600;

    const pvW = r.pv_power ?? 0;
    const loadW = r.load_power ?? 0;
    const pvKwh = (pvW * dtHours) / 1000;
    const loadKwh = (loadW * dtHours) / 1000;

    let importKwh = 0;
    let exportKwh = 0;
    const powerLimitKwh = maxPowerKw * dtHours;

    if (pvKwh >= loadKwh) {
      const surplus = pvKwh - loadKwh;
      const capacityHeadroomKwh = (capacityKwh - currentEnergyKwh) / legEff;
      const chargeInKwh = Math.max(0, Math.min(surplus, powerLimitKwh, capacityHeadroomKwh));
      currentEnergyKwh = Math.min(capacityKwh, currentEnergyKwh + chargeInKwh * legEff);
      exportKwh = Math.max(0, surplus - chargeInKwh);
    } else {
      const deficit = loadKwh - pvKwh;
      const availableOutKwh = (currentEnergyKwh - minEnergyKwh) * legEff;
      const dischargeOutKwh = Math.max(0, Math.min(deficit, powerLimitKwh, availableOutKwh));
      currentEnergyKwh = Math.max(minEnergyKwh, currentEnergyKwh - dischargeOutKwh / legEff);
      importKwh = Math.max(0, deficit - dischargeOutKwh);
    }

    const slotMs = halfHourStartMs(ts);
    const importRate = importRateMap.get(slotMs) ?? 0;
    const exportRate = exportRateMap.get(slotMs) ?? 0;
    const cost = importKwh * importRate - exportKwh * exportRate;

    const dateStr = r.timestamp.slice(0, 10);
    let bucket = daily.get(dateStr);
    if (!bucket) {
      bucket = { date: dateStr, import_kwh: 0, export_kwh: 0, cost: 0 };
      daily.set(dateStr, bucket);
    }
    bucket.import_kwh += importKwh;
    bucket.export_kwh += exportKwh;
    bucket.cost += cost;
  }

  const dailyList: PassiveBatteryDay[] = Array.from(daily.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      import_kwh: round2(d.import_kwh),
      export_kwh: round2(d.export_kwh),
      cost: round2(d.cost),
    }));

  const totalImport = dailyList.reduce((a, b) => a + b.import_kwh, 0);
  const totalExport = dailyList.reduce((a, b) => a + b.export_kwh, 0);
  const totalCost = dailyList.reduce((a, b) => a + b.cost, 0);

  return {
    daily: dailyList,
    summary: {
      capacity_kwh: capacityKwh,
      min_soc_pct: minSocPct,
      max_power_kw: maxPowerKw,
      round_trip_efficiency: roundTripEff,
      starting_soc_pct: startingSocPct,
      import_kwh: round2(totalImport),
      export_kwh: round2(totalExport),
      cost: round2(totalCost),
      simulated_seconds: Math.round(totalSimSeconds),
    },
  };
}
