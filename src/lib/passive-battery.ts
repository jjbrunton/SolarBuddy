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
  rte_source: 'calibrated' | 'fallback';
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
// Fallback used when there is not enough history to calibrate a real RTE
// from observed charge-in vs discharge-out energy. 0.9 is the manufacturer
// spec for a typical hybrid inverter — real systems usually run lower once
// AC↔DC conversion, BMS overhead, and standby draw are included.
const FALLBACK_ROUND_TRIP_EFFICIENCY = 0.9;
// Hard bounds so a degenerate calibration (insufficient cycling, missing
// readings, weird SOC trace) cannot produce a wildly unrealistic RTE.
const MIN_CALIBRATED_RTE = 0.5;
const MAX_CALIBRATED_RTE = 0.99;
// Need at least this much energy moved through the battery before we trust
// the ratio. Below this, noise dominates.
const MIN_THROUGHPUT_KWH_FOR_CALIBRATION = 5;

function halfHourStartMs(ts: number): number {
  return Math.floor(ts / HALF_HOUR_MS) * HALF_HOUR_MS;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CalibrationReading {
  timestamp: string;
  pv_power: number | null;
  load_power: number | null;
  grid_power: number | null;
  battery_soc: number | null;
}

export interface RoundTripCalibration {
  round_trip_efficiency: number;
  source: 'calibrated' | 'fallback';
  charge_kwh: number;
  discharge_kwh: number;
  soc_delta_kwh: number;
  sample_count: number;
}

// In-memory memo for the rolling-30-day calibration. Recomputing on every
// attribution / scoreSlots request was a 30-day readings scan even when
// the cache was hot. RTE drifts slowly (battery degradation, weather
// shifts), so a 30-min TTL is plenty fresh and avoids the repeated scan.
const CALIBRATION_TTL_MS = 30 * 60 * 1000;
const calibrationMemo = new Map<number, { ts: number; result: RoundTripCalibration }>();

/** Test-only — clears the per-process RTE calibration memo. */
export function _resetCalibrationCacheForTests(): void {
  calibrationMemo.clear();
}

// Calibrate round-trip efficiency from observed history.
//
// Energy balance for each sample interval:
//   battery_net_W = pv_power − load_power + grid_power
// (grid_power is positive on import, negative on export — see attribution.ts.)
//
// Integrating gives total AC-side energy into the battery (charge_kwh) and
// out of it (discharge_kwh). With charge/discharge legs both at √RTE and the
// observed DC-side change ΔSOC × capacity:
//
//   charge_kwh × √RTE − discharge_kwh / √RTE = ΔSOC_kwh
//
// Solving for x = √RTE: charge·x² − ΔSOC·x − discharge = 0
//   x = (ΔSOC + √(ΔSOC² + 4·charge·discharge)) / (2·charge)
//
// Standby/parasitic losses bias both sides slightly but don't change the
// ratio meaningfully. If throughput is too low or the result falls outside
// plausible bounds we fall back to the spec value.
export function calibrateRoundTripEfficiency(
  capacityKwh: number,
  daysBack = 30,
): RoundTripCalibration {
  const memoKey = Math.round(capacityKwh * 1000) + daysBack * 1_000_000;
  const hit = calibrationMemo.get(memoKey);
  if (hit && Date.now() - hit.ts < CALIBRATION_TTL_MS) return hit.result;

  const result = computeCalibration(capacityKwh, daysBack);
  calibrationMemo.set(memoKey, { ts: Date.now(), result });
  return result;
}

function computeCalibration(capacityKwh: number, daysBack: number): RoundTripCalibration {
  const fallback: RoundTripCalibration = {
    round_trip_efficiency: FALLBACK_ROUND_TRIP_EFFICIENCY,
    source: 'fallback',
    charge_kwh: 0,
    discharge_kwh: 0,
    soc_delta_kwh: 0,
    sample_count: 0,
  };

  const db = getDb();
  const fromISO = new Date(Date.now() - daysBack * 86400000).toISOString();
  const readings = db
    .prepare(
      `SELECT timestamp, pv_power, load_power, grid_power, battery_soc
       FROM readings
       WHERE timestamp >= ?
       ORDER BY timestamp ASC`,
    )
    .all(fromISO) as CalibrationReading[];

  if (readings.length < 2) return fallback;

  let chargeKwh = 0;
  let dischargeKwh = 0;
  let firstSoc: number | null = null;
  let lastSoc: number | null = null;

  for (let i = 0; i < readings.length - 1; i++) {
    const r = readings[i];
    const next = readings[i + 1];
    const dtHours = Math.min(
      (new Date(next.timestamp).getTime() - new Date(r.timestamp).getTime()) / 3600000,
      MAX_DT_HOURS,
    );
    if (!(dtHours > 0)) continue;

    const pv = r.pv_power ?? 0;
    const load = r.load_power ?? 0;
    const grid = r.grid_power ?? 0;
    const batteryNetW = pv - load + grid;
    const energyKwh = (batteryNetW * dtHours) / 1000;

    if (energyKwh > 0) chargeKwh += energyKwh;
    else dischargeKwh += -energyKwh;

    if (r.battery_soc != null) {
      if (firstSoc == null) firstSoc = r.battery_soc;
      lastSoc = r.battery_soc;
    }
  }

  const socDeltaKwh =
    firstSoc != null && lastSoc != null ? (capacityKwh * (lastSoc - firstSoc)) / 100 : 0;

  if (chargeKwh + dischargeKwh < MIN_THROUGHPUT_KWH_FOR_CALIBRATION) return fallback;
  if (chargeKwh <= 0) return fallback;

  const discriminant = socDeltaKwh * socDeltaKwh + 4 * chargeKwh * dischargeKwh;
  if (discriminant < 0) return fallback;

  const x = (socDeltaKwh + Math.sqrt(discriminant)) / (2 * chargeKwh);
  const rte = x * x;

  if (!Number.isFinite(rte) || rte < MIN_CALIBRATED_RTE || rte > MAX_CALIBRATED_RTE) {
    return fallback;
  }

  return {
    round_trip_efficiency: Math.round(rte * 1000) / 1000,
    source: 'calibrated',
    charge_kwh: round2(chargeKwh),
    discharge_kwh: round2(dischargeKwh),
    soc_delta_kwh: round2(socDeltaKwh),
    sample_count: readings.length,
  };
}

export function simulatePassiveBattery(period: string): {
  daily: PassiveBatteryDay[];
  summary: PassiveBatterySummary;
} {
  return simulatePassiveBatteryRange({ fromISO: periodToISO(period) });
}

// Simulate over an explicit ISO range. Used by the daily recompute path so
// a single past day can be re-simulated with its starting SOC seeded from
// that day's first recorded reading. The string-period entry point above is
// kept for backwards compatibility; new callers should use the range form.
export function simulatePassiveBatteryRange({
  fromISO,
  toExclusiveISO,
}: {
  fromISO: string;
  toExclusiveISO?: string;
}): {
  daily: PassiveBatteryDay[];
  summary: PassiveBatterySummary;
} {
  const from = fromISO;
  const settings = getSettings();
  const capacityKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
  const minSocPct = parseFloat(settings.discharge_soc_floor) || 20;
  const maxPowerKw = parseFloat(settings.max_charge_power_kw) || 3.6;
  const calibration = calibrateRoundTripEfficiency(capacityKwh);
  const roundTripEff = calibration.round_trip_efficiency;
  const legEff = Math.sqrt(roundTripEff);

  const minEnergyKwh = (capacityKwh * minSocPct) / 100;
  const db = getDb();

  const readings = (toExclusiveISO != null
    ? db
        .prepare(
          `SELECT timestamp, pv_power, load_power, battery_soc
           FROM readings
           WHERE timestamp >= ? AND timestamp < ?
           ORDER BY timestamp ASC`,
        )
        .all(from, toExclusiveISO)
    : db
        .prepare(
          `SELECT timestamp, pv_power, load_power, battery_soc
           FROM readings
           WHERE timestamp >= ?
           ORDER BY timestamp ASC`,
        )
        .all(from)) as ReadingRow[];

  const emptyConfig: PassiveBatteryConfig = {
    capacity_kwh: capacityKwh,
    min_soc_pct: minSocPct,
    max_power_kw: maxPowerKw,
    round_trip_efficiency: roundTripEff,
    rte_source: calibration.source,
    starting_soc_pct: 0,
  };

  if (readings.length < 2) {
    return {
      daily: [],
      summary: { ...emptyConfig, import_kwh: 0, export_kwh: 0, cost: 0, simulated_seconds: 0 },
    };
  }

  // Load rates for the window once and index by half-hour bucket.
  const toISO = toExclusiveISO ?? new Date(Date.now() + 86400000).toISOString();
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
      rte_source: calibration.source,
      starting_soc_pct: startingSocPct,
      import_kwh: round2(totalImport),
      export_kwh: round2(totalExport),
      cost: round2(totalCost),
      simulated_seconds: Math.round(totalSimSeconds),
    },
  };
}
