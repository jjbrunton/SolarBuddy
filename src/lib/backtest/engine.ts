// Historical backtest: replay the planner against past rates and score it
// against measured load/PV from `readings`. This answers "would different
// strategy settings have saved me more money over the last N days?" — it is
// a counterfactual on the SCHEDULING decision, holding the actual house
// load, solar generation, and tariff fixed.
//
// Per day in range:
//   1. Load rates, export_rates, and raw readings for the day.
//   2. Bucket readings into half-hour slots (measured load/PV).
//   3. Run buildSchedulePlan with the overridden settings, anchored at the
//      start of that day so the planner sees the whole day as future.
//   4. Replay slot-by-slot against the MEASURED load and PV to derive net
//      grid flow → import/export kWh → cost.
//   5. Also derive baseline_cost (load × import_rate) and passive_cost (from
//      the existing passive-battery simulator) for that day.
//   6. Emit AttributionDay-shaped rows so the existing UI can render the
//      result without any new chart code.
//
// The planner uses whatever demand forecast it always uses
// (getForecastedConsumptionW). That matches what it actually had access to
// at plan time — we are not letting the alt-config cheat by seeing future
// load. We only use measured load/PV in the REPLAY step to score the plan.

import { getDb } from '../db';
import { getSettings, type AppSettings } from '../config';
import { buildSchedulePlan, type PlannedSlot } from '../scheduler/engine';
import type { AgileRate } from '../octopus/rates';
import {
  aggregateReadingsBySlot,
  halfHourStartISO,
  type ReadingSample,
  type MeasuredSlot,
} from './slot-aggregation';
import { simulatePassiveBattery, calibrateRoundTripEfficiency } from '../passive-battery';

export interface BacktestDay {
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
  slot_count: number;
  charge_slots: number;
  discharge_slots: number;
  hold_slots: number;
}

export interface BacktestSlot {
  slot_start: string;
  action: 'charge' | 'discharge' | 'hold';
  reason: string;
  import_rate: number;
  export_rate: number;
  load_kwh: number;
  pv_kwh: number;
  soc_before: number;
  soc_after: number;
  sim_import_kwh: number;
  sim_export_kwh: number;
  sim_cost: number;
  passive_cost: number | null;
  actual_cost: number | null;
}

export interface BacktestSummary {
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
  days_covered: number;
  slots_covered: number;
}

export interface BacktestParams {
  fromISO: string;
  toISO: string;
  settingsOverrides?: Partial<AppSettings>;
  includeSlots?: boolean;
}

export interface BacktestResult {
  summary: BacktestSummary;
  daily: BacktestDay[];
  slots?: BacktestSlot[];
  effective_settings: AppSettings;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function addDaysUTC(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function startOfUTCDay(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function loadRates(db: ReturnType<typeof getDb>, fromISO: string, toISO: string): AgileRate[] {
  return db
    .prepare(
      'SELECT valid_from, valid_to, price_inc_vat FROM rates WHERE valid_from >= ? AND valid_from < ? ORDER BY valid_from ASC',
    )
    .all(fromISO, toISO) as AgileRate[];
}

function loadExportRates(
  db: ReturnType<typeof getDb>,
  fromISO: string,
  toISO: string,
): AgileRate[] {
  return db
    .prepare(
      'SELECT valid_from, valid_to, price_inc_vat FROM export_rates WHERE valid_from >= ? AND valid_from < ? ORDER BY valid_from ASC',
    )
    .all(fromISO, toISO) as AgileRate[];
}

function loadReadings(
  db: ReturnType<typeof getDb>,
  fromISO: string,
  toISO: string,
): ReadingSample[] {
  return db
    .prepare(
      'SELECT timestamp, load_power, pv_power, grid_power, battery_soc FROM readings WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC',
    )
    .all(fromISO, toISO) as ReadingSample[];
}

function groupByDate<T extends { valid_from?: string; slot_start?: string; timestamp?: string }>(
  rows: T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = dateKey(key(row));
    const bucket = out.get(k) ?? [];
    bucket.push(row);
    out.set(k, bucket);
  }
  return out;
}

interface ReplayInputs {
  settings: AppSettings;
  date: string;
  rates: AgileRate[];
  exportRates: AgileRate[];
  measured: MeasuredSlot[];
  startingSoc: number;
}

interface ReplayOutput {
  day: BacktestDay;
  slots: BacktestSlot[];
}

/**
 * Run the planner and score it against measured load/PV for a single day.
 */
function replayDay(
  { settings, date, rates, exportRates, measured, startingSoc }: ReplayInputs,
): ReplayOutput {
  const measuredMap = new Map(measured.map((m) => [m.slot_start, m]));
  const exportMap = new Map(exportRates.map((er) => [halfHourStartISO(er.valid_from), er.price_inc_vat]));

  const anchorNow = new Date(`${date}T00:00:00Z`);
  const plan = buildSchedulePlan(rates, settings, {
    currentSoc: startingSoc,
    now: anchorNow,
    exportRates,
  });

  const plannedMap = new Map<string, PlannedSlot>();
  for (const s of plan.slots) plannedMap.set(halfHourStartISO(s.slot_start), s);

  const capacityKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
  const maxPowerKw = parseFloat(settings.max_charge_power_kw) || 3.6;
  const chargeRate = parseFloat(settings.charge_rate) || 100;
  const effectiveChargeKw = maxPowerKw * (chargeRate / 100);
  const chargeKwhPerSlot = effectiveChargeKw * 0.5;
  const minSocPct = parseFloat(settings.discharge_soc_floor) || 20;
  const minEnergyKwh = (capacityKwh * minSocPct) / 100;
  const legEff = Math.sqrt(0.9);

  let energyKwh = Math.max(minEnergyKwh, Math.min(capacityKwh, (capacityKwh * startingSoc) / 100));

  const slots: BacktestSlot[] = [];
  let importKwh = 0;
  let exportKwh = 0;
  let simCost = 0;
  let baselineCost = 0;
  let loadKwh = 0;

  let chargeSlots = 0;
  let dischargeSlots = 0;
  let holdSlots = 0;

  for (const rate of rates) {
    const slotKey = halfHourStartISO(rate.valid_from);
    const m = measuredMap.get(slotKey);
    if (!m) continue;

    const planned = plannedMap.get(slotKey);
    const action: 'charge' | 'discharge' | 'hold' =
      planned?.action === 'charge' || planned?.action === 'discharge' ? planned.action : 'hold';
    const reason = planned?.reason ?? 'No plan for this slot.';

    const importRate = rate.price_inc_vat;
    const exportRate = exportMap.get(slotKey) ?? 0;

    const socBeforePct = (energyKwh / capacityKwh) * 100;

    let slotImportKwh = 0;
    let slotExportKwh = 0;
    let batteryNetKwh = 0;

    if (action === 'charge') {
      const headroom = (capacityKwh - energyKwh) / legEff;
      const gridChargeKwh = Math.max(0, Math.min(chargeKwhPerSlot, headroom));
      energyKwh = Math.min(capacityKwh, energyKwh + gridChargeKwh * legEff);
      batteryNetKwh = gridChargeKwh;
      const net = m.load_kwh - m.pv_kwh + gridChargeKwh;
      if (net >= 0) slotImportKwh = net;
      else slotExportKwh = -net;
      chargeSlots++;
    } else if (action === 'discharge') {
      const available = (energyKwh - minEnergyKwh) * legEff;
      const drawKwh = Math.max(0, Math.min(chargeKwhPerSlot, available));
      energyKwh = Math.max(minEnergyKwh, energyKwh - drawKwh / legEff);
      batteryNetKwh = -drawKwh;
      const net = m.load_kwh - m.pv_kwh - drawKwh;
      if (net >= 0) slotImportKwh = net;
      else slotExportKwh = -net;
      dischargeSlots++;
    } else {
      // hold: battery preserved. Surplus PV can still charge passively, but
      // we keep this conservative and treat hold as "battery idle" in the
      // backtest. Net grid = load - pv. This mirrors the watchdog's
      // "load-first + stop-discharge at current SOC" behavior described in
      // docs/architecture.md: the battery does not supply load and surplus
      // PV export goes to the grid.
      const net = m.load_kwh - m.pv_kwh;
      if (net >= 0) slotImportKwh = net;
      else slotExportKwh = -net;
      holdSlots++;
    }

    importKwh += slotImportKwh;
    exportKwh += slotExportKwh;
    const slotCost = slotImportKwh * importRate - slotExportKwh * exportRate;
    simCost += slotCost;

    baselineCost += m.load_kwh * importRate;
    loadKwh += m.load_kwh;

    const socAfterPct = (energyKwh / capacityKwh) * 100;

    slots.push({
      slot_start: slotKey,
      action,
      reason,
      import_rate: importRate,
      export_rate: exportRate,
      load_kwh: round3(m.load_kwh),
      pv_kwh: round3(m.pv_kwh),
      soc_before: Math.round(socBeforePct * 10) / 10,
      soc_after: Math.round(socAfterPct * 10) / 10,
      sim_import_kwh: round3(slotImportKwh),
      sim_export_kwh: round3(slotExportKwh),
      sim_cost: round2(slotCost),
      passive_cost: null,
      actual_cost: round2(
        Math.max(0, m.grid_import_kwh) * importRate - Math.max(0, m.grid_export_kwh) * exportRate,
      ),
    });

    void batteryNetKwh;
  }

  const day: BacktestDay = {
    date,
    load_kwh: round2(loadKwh),
    import_kwh: round2(importKwh),
    export_kwh: round2(exportKwh),
    passive_import_kwh: 0,
    passive_export_kwh: 0,
    baseline_cost: round2(baselineCost),
    passive_cost: 0,
    actual_cost: round2(simCost),
    hardware_saving: 0,
    scheduling_saving: 0,
    total_saving: 0,
    slot_count: slots.length,
    charge_slots: chargeSlots,
    discharge_slots: dischargeSlots,
    hold_slots: holdSlots,
  };

  return { day, slots };
}

/**
 * Convert an (ISO, ISO) window to a period string the passive simulator
 * understands. For backtests we approximate by using the number of days
 * from `from` to now and letting the simulator slice on `readings.timestamp
 * >= from`. This is a reuse convenience — the passive baseline is scored
 * against real readings, so changing strategy settings does not change it.
 */
function periodFromWindow(fromISO: string): string {
  const now = Date.now();
  const fromMs = new Date(fromISO).getTime();
  const days = Math.max(1, Math.ceil((now - fromMs) / 86_400_000));
  return `${days}d`;
}

export function runBacktest(params: BacktestParams): BacktestResult {
  const fromISO = startOfUTCDay(params.fromISO);
  const toExclusiveISO = addDaysUTC(startOfUTCDay(params.toISO), 1);

  const baseSettings = getSettings();
  const effectiveSettings: AppSettings = {
    ...baseSettings,
    ...(params.settingsOverrides ?? {}),
  } as AppSettings;

  const db = getDb();
  const rates = loadRates(db, fromISO, toExclusiveISO);
  const exportRates = loadExportRates(db, fromISO, toExclusiveISO);
  const readings = loadReadings(db, fromISO, toExclusiveISO);

  const ratesByDate = groupByDate(rates, (r) => r.valid_from);
  const exportByDate = groupByDate(exportRates, (r) => r.valid_from);
  const readingsByDate = groupByDate(readings, (r) => r.timestamp);

  const passive = simulatePassiveBattery(periodFromWindow(fromISO));
  const passiveByDate = new Map(passive.daily.map((d) => [d.date, d]));

  const dates = new Set<string>();
  ratesByDate.forEach((_, k) => dates.add(k));
  readingsByDate.forEach((_, k) => dates.add(k));
  const sortedDates = Array.from(dates).sort();

  const daily: BacktestDay[] = [];
  const allSlots: BacktestSlot[] = [];

  for (const date of sortedDates) {
    const dayReadings = readingsByDate.get(date) ?? [];
    const dayRates = ratesByDate.get(date) ?? [];
    if (dayRates.length === 0 || dayReadings.length === 0) continue;

    const measured = aggregateReadingsBySlot(dayReadings);
    if (measured.length === 0) continue;

    const startingSoc = measured[0].starting_soc ?? 50;

    const { day, slots } = replayDay({
      settings: effectiveSettings,
      date,
      rates: dayRates,
      exportRates: exportByDate.get(date) ?? [],
      measured,
      startingSoc,
    });

    const pass = passiveByDate.get(date);
    if (pass) {
      day.passive_cost = round2(pass.cost);
      day.passive_import_kwh = pass.import_kwh;
      day.passive_export_kwh = pass.export_kwh;
    } else {
      day.passive_cost = day.actual_cost;
    }
    day.hardware_saving = round2(day.baseline_cost - day.passive_cost);
    day.scheduling_saving = round2(day.passive_cost - day.actual_cost);
    day.total_saving = round2(day.hardware_saving + day.scheduling_saving);

    daily.push(day);

    if (params.includeSlots) {
      for (const s of slots) allSlots.push(s);
    }
  }

  const sum = <K extends keyof BacktestDay>(key: K): number =>
    daily.reduce((acc, d) => acc + (d[key] as number), 0);

  const summary: BacktestSummary = {
    load_kwh: round2(sum('load_kwh')),
    import_kwh: round2(sum('import_kwh')),
    export_kwh: round2(sum('export_kwh')),
    passive_import_kwh: round2(sum('passive_import_kwh')),
    passive_export_kwh: round2(sum('passive_export_kwh')),
    baseline_cost: round2(sum('baseline_cost')),
    passive_cost: round2(sum('passive_cost')),
    actual_cost: round2(sum('actual_cost')),
    hardware_saving: round2(sum('hardware_saving')),
    scheduling_saving: round2(sum('scheduling_saving')),
    total_saving: round2(sum('total_saving')),
    days_covered: daily.length,
    slots_covered: daily.reduce((acc, d) => acc + d.slot_count, 0),
  };

  return {
    summary,
    daily,
    slots: params.includeSlots ? allSlots : undefined,
    effective_settings: effectiveSettings,
  };
}

/**
 * Identify slots where SolarBuddy's real, measured behavior performed
 * worst vs the passive counterfactual. Uses the actual readings (not a
 * backtest-replay) so the answer reflects what the running planner really
 * did, not what an alt-config would have done.
 *
 * The ranking is slot-level `actual − passive` cost — positive means the
 * real plan cost more than a passive self-use battery would have in that
 * slot. We read plan_slots to show the operator what action SolarBuddy
 * chose and why.
 */
export interface WorstSlot {
  slot_start: string;
  action: string | null;
  reason: string | null;
  import_rate: number;
  export_rate: number;
  load_kwh: number;
  pv_kwh: number;
  actual_import_kwh: number;
  actual_export_kwh: number;
  actual_cost: number;
  passive_cost: number;
  delta: number;
}

// Live, uncached scoring. Used by both the cache-fill path and as the
// fallback for the in-progress current day. Splitting this out from
// scoreSlots() lets the public function read from cache for completed days
// and only invoke the heavy work for today.
function scoreSlotsLive(params: { fromISO: string; toISO: string }): WorstSlot[] {
  const fromISO = startOfUTCDay(params.fromISO);
  const toExclusiveISO = addDaysUTC(startOfUTCDay(params.toISO), 1);

  const db = getDb();
  const rates = loadRates(db, fromISO, toExclusiveISO);
  const exportRates = loadExportRates(db, fromISO, toExclusiveISO);
  const readings = loadReadings(db, fromISO, toExclusiveISO);

  if (readings.length === 0 || rates.length === 0) return [];

  const exportMap = new Map(
    exportRates.map((er) => [halfHourStartISO(er.valid_from), er.price_inc_vat]),
  );
  const rateMap = new Map(rates.map((r) => [halfHourStartISO(r.valid_from), r]));
  const measured = aggregateReadingsBySlot(readings);

  const settings = getSettings();
  const capacityKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
  const minSocPct = parseFloat(settings.discharge_soc_floor) || 20;
  const maxPowerKw = parseFloat(settings.max_charge_power_kw) || 3.6;
  const minEnergyKwh = (capacityKwh * minSocPct) / 100;
  const calibration = calibrateRoundTripEfficiency(capacityKwh);
  const legEff = Math.sqrt(calibration.round_trip_efficiency);

  const startingSocPct = measured[0]?.starting_soc ?? 50;
  let energyKwh = Math.max(
    minEnergyKwh,
    Math.min(capacityKwh, (capacityKwh * startingSocPct) / 100),
  );

  const planRows = db
    .prepare(
      'SELECT slot_start, action, reason FROM plan_slots WHERE slot_start >= ? AND slot_start < ?',
    )
    .all(fromISO, toExclusiveISO) as Array<{ slot_start: string; action: string; reason: string | null }>;
  const planMap = new Map(planRows.map((p) => [halfHourStartISO(p.slot_start), p]));

  const scored: WorstSlot[] = [];

  for (const m of measured) {
    const rate = rateMap.get(m.slot_start);
    if (!rate) continue;
    const importRate = rate.price_inc_vat;
    const exportRate = exportMap.get(m.slot_start) ?? 0;

    const actualCost =
      Math.max(0, m.grid_import_kwh) * importRate - Math.max(0, m.grid_export_kwh) * exportRate;

    // Per-slot passive counterfactual: given the current battery energy, what
    // would a self-use controller have imported/exported this slot?
    const powerLimitKwh = maxPowerKw * 0.5;
    let passiveImport = 0;
    let passiveExport = 0;
    if (m.pv_kwh >= m.load_kwh) {
      const surplus = m.pv_kwh - m.load_kwh;
      const headroom = (capacityKwh - energyKwh) / legEff;
      const chargeIn = Math.max(0, Math.min(surplus, powerLimitKwh, headroom));
      energyKwh = Math.min(capacityKwh, energyKwh + chargeIn * legEff);
      passiveExport = Math.max(0, surplus - chargeIn);
    } else {
      const deficit = m.load_kwh - m.pv_kwh;
      const available = (energyKwh - minEnergyKwh) * legEff;
      const dischargeOut = Math.max(0, Math.min(deficit, powerLimitKwh, available));
      energyKwh = Math.max(minEnergyKwh, energyKwh - dischargeOut / legEff);
      passiveImport = Math.max(0, deficit - dischargeOut);
    }
    const passiveCost = passiveImport * importRate - passiveExport * exportRate;
    const delta = actualCost - passiveCost;

    const plan = planMap.get(m.slot_start);

    scored.push({
      slot_start: m.slot_start,
      action: plan?.action ?? null,
      reason: plan?.reason ?? null,
      import_rate: importRate,
      export_rate: exportRate,
      load_kwh: round3(m.load_kwh),
      pv_kwh: round3(m.pv_kwh),
      actual_import_kwh: round3(m.grid_import_kwh),
      actual_export_kwh: round3(m.grid_export_kwh),
      actual_cost: round2(actualCost),
      passive_cost: round2(passiveCost),
      delta: round2(delta),
    });
  }

  return scored;
}

function readCachedSlotScores(fromISO: string, toExclusiveISO: string): WorstSlot[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT slot_start, action, reason, import_rate, export_rate, load_kwh, pv_kwh,
        actual_import_kwh, actual_export_kwh, actual_cost, passive_cost, delta
       FROM slot_scores_cache
       WHERE slot_start >= ? AND slot_start < ?
       ORDER BY slot_start ASC`,
    )
    .all(fromISO, toExclusiveISO) as WorstSlot[];
}

function upsertCachedSlotScores(rows: WorstSlot[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO slot_scores_cache (
       slot_start, action, reason, import_rate, export_rate, load_kwh, pv_kwh,
       actual_import_kwh, actual_export_kwh, actual_cost, passive_cost, delta, computed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slot_start) DO UPDATE SET
       action=excluded.action,
       reason=excluded.reason,
       import_rate=excluded.import_rate,
       export_rate=excluded.export_rate,
       load_kwh=excluded.load_kwh,
       pv_kwh=excluded.pv_kwh,
       actual_import_kwh=excluded.actual_import_kwh,
       actual_export_kwh=excluded.actual_export_kwh,
       actual_cost=excluded.actual_cost,
       passive_cost=excluded.passive_cost,
       delta=excluded.delta,
       computed_at=excluded.computed_at`,
  );
  const now = new Date().toISOString();
  const tx = db.transaction((items: WorstSlot[]) => {
    for (const r of items) {
      stmt.run(
        r.slot_start,
        r.action,
        r.reason,
        r.import_rate,
        r.export_rate,
        r.load_kwh,
        r.pv_kwh,
        r.actual_import_kwh,
        r.actual_export_kwh,
        r.actual_cost,
        r.passive_cost,
        r.delta,
        now,
      );
    }
  });
  tx(rows);
}

// Recompute slot scores over a date range and persist to cache. Called by
// the daily cron and the manual recompute button.
export function recomputeSlotScoresForRange(params: { fromISO: string; toISO: string }): {
  slots_recomputed: number;
} {
  const scored = scoreSlotsLive(params);
  upsertCachedSlotScores(scored);
  return { slots_recomputed: scored.length };
}

// Tiny in-process memo so the three endpoints that each call scoreSlots()
// for the same window (best, worst, efficacy) share one live-scoring pass
// when fired in parallel from the savings page. TTL is short — we'd
// rather pay a few extra ms than serve stale data — and the cache key
// includes the requested range so different periods don't collide.
const SCORE_MEMO_TTL_MS = 5_000;
const scoreMemo = new Map<string, { ts: number; rows: WorstSlot[] }>();

function memoizedScoreSlots(params: { fromISO: string; toISO: string }): WorstSlot[] {
  const key = `${params.fromISO}|${params.toISO}`;
  const hit = scoreMemo.get(key);
  if (hit && Date.now() - hit.ts < SCORE_MEMO_TTL_MS) return hit.rows;
  const rows = scoreSlotsImpl(params);
  scoreMemo.set(key, { ts: Date.now(), rows });
  return rows;
}

/** Test-only — clears the per-process scoreSlots memo. */
export function _resetScoreMemoForTests(): void {
  scoreMemo.clear();
}

// Cache-aware scorer. Reads cached rows for completed days and live-scores
// only the in-progress current day. On a healthy install the cron has
// already populated the cache; if the cache is empty (fresh install, post-
// migration) we fall back to a full live pass — slow but only once, the
// next cron tick fills the cache and subsequent loads are fast.
export function scoreSlots(params: { fromISO: string; toISO: string }): WorstSlot[] {
  return memoizedScoreSlots(params);
}

function scoreSlotsImpl(params: { fromISO: string; toISO: string }): WorstSlot[] {
  const fromISO = startOfUTCDay(params.fromISO);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // Cached slice ends at the start of today (today is always live).
  const cachedTo = todayISO > fromISO ? todayISO : fromISO;
  const cached = cachedTo > fromISO ? readCachedSlotScores(fromISO, cachedTo) : [];

  // Empty-cache fallback: one full live pass over the requested window.
  if (cached.length === 0) {
    return scoreSlotsLive(params).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  }

  const cachedSlotStarts = new Set(cached.map((r) => r.slot_start));
  const liveToday = scoreSlotsLive({ fromISO: cachedTo, toISO: params.toISO }).filter(
    (s) => !cachedSlotStarts.has(s.slot_start),
  );

  return [...cached, ...liveToday].sort((a, b) => a.slot_start.localeCompare(b.slot_start));
}

export function getWorstSlots(params: { fromISO: string; toISO: string; limit?: number }): WorstSlot[] {
  const limit = Math.max(1, Math.min(100, params.limit ?? 10));
  const scored = scoreSlots(params);
  scored.sort((a, b) => b.delta - a.delta);
  return scored.slice(0, limit);
}

// Mirror of getWorstSlots for the wins side: slots where the real plan beat
// a passive self-use battery. Same scoring, just sorted ascending so the
// biggest savings come first.
export function getBestSlots(params: { fromISO: string; toISO: string; limit?: number }): WorstSlot[] {
  const limit = Math.max(1, Math.min(100, params.limit ?? 10));
  const scored = scoreSlots(params);
  scored.sort((a, b) => a.delta - b.delta);
  return scored.slice(0, limit);
}

export interface SchedulingEfficacy {
  // Sum of |delta| over slots where actual was cheaper than passive.
  gross_wins_pence: number;
  // Sum of delta over slots where actual was more expensive than passive.
  gross_losses_pence: number;
  // wins − losses. Matches AttributionSummary.scheduling_saving over the
  // same window, modulo rounding.
  net_pence: number;
  // Ratio of beneficial activity. 100 = every active slot helped, 50 =
  // break-even, 0 = every active slot hurt. NaN guarded → 0 when there is
  // no scheduler activity at all.
  efficacy_pct: number;
  win_slot_count: number;
  loss_slot_count: number;
  // Slots where actual ≈ passive (delta within ±0.1p). Excluded from the
  // ratio because they're not really "scheduler activity".
  neutral_slot_count: number;
  total_slot_count: number;
}

const NEUTRAL_DELTA_PENCE = 0.1;

export function getSchedulingEfficacy(params: { fromISO: string; toISO: string }): SchedulingEfficacy {
  const scored = scoreSlots(params);

  let grossWins = 0;
  let grossLosses = 0;
  let winCount = 0;
  let lossCount = 0;
  let neutralCount = 0;

  for (const slot of scored) {
    if (slot.delta < -NEUTRAL_DELTA_PENCE) {
      grossWins += -slot.delta;
      winCount++;
    } else if (slot.delta > NEUTRAL_DELTA_PENCE) {
      grossLosses += slot.delta;
      lossCount++;
    } else {
      neutralCount++;
    }
  }

  const activity = grossWins + grossLosses;
  const efficacyPct = activity > 0 ? (grossWins / activity) * 100 : 0;

  return {
    gross_wins_pence: round2(grossWins),
    gross_losses_pence: round2(grossLosses),
    net_pence: round2(grossWins - grossLosses),
    efficacy_pct: Math.round(efficacyPct * 10) / 10,
    win_slot_count: winCount,
    loss_slot_count: lossCount,
    neutral_slot_count: neutralCount,
    total_slot_count: scored.length,
  };
}
