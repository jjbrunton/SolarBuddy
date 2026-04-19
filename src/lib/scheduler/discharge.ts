import { AppSettings } from '../config';
import { AgileRate } from '../octopus/rates';
import {
  getAverageForecastedConsumptionW,
  getForecastedConsumptionW,
} from '../usage';
import {
  ChargeWindow,
  PlanningContext,
  getChargingStrategy,
  isEligibleRate,
  isInChargeWindow,
  mergeAdjacentSlots,
  parseSlotBudget,
} from './engine';

const HALF_HOUR_HOURS = 0.5;
const DEFAULT_DISCHARGE_EFFICIENCY = 0.92;
const DEFAULT_BATTERY_WEAR_PENCE_PER_KWH = 1.0;

interface DischargeEconomics {
  dischargeEfficiency: number;
  batteryWearPencePerKwh: number;
}

interface SlotModel {
  key: string;
  rate: AgileRate;
  exportPrice: number;
  pvEstimateWh: number;
  startMs: number;
  endMs: number;
  baseChargeCandidate: boolean;
  peakChargeCandidate: boolean;
  dischargeCandidate: boolean;
}

interface TargetConstraint {
  deadlineMs: number;
  targetSoc: number;
  canUseCharge: (slot: SlotModel) => boolean;
}

interface ActionPlan {
  chargeKeys: Set<string>;
  dischargeKeys: Set<string>;
  extraChargeKeys: Set<string>;
}

interface SimulationPoint {
  key: string;
  endMs: number;
  socAfterWh: number;
  actualDischargeWh: number;
  /** Grid energy actually drawn for a charge slot — zero if the battery
   *  was already at capacity (no further grid draw is possible). */
  actualChargeWh: number;
}

interface EnergyModel {
  batteryCapacityWh: number;
  chargePerSlotWh: number;
  /**
   * Expected household consumption in Wh for a half-hour slot starting at the
   * given ms timestamp. When the usage profile is available this returns the
   * learned median for that slot; otherwise it returns the flat
   * estimated_consumption_w fallback. Callers use this for both "house load"
   * (charge/hold slots) and "battery output rate" (discharge slots) — the
   * existing approximation that treats those as equal is preserved here.
   */
  drainWhAtMs: (startMs: number) => number;
  /** Scalar fallback, retained for logging and legacy diagnostics. */
  fallbackDrainPerSlotWh: number;
}

export interface SmartDischargePlan {
  extraChargeWindows: ChargeWindow[];
  dischargeWindows: ChargeWindow[];
  _debug?: SmartDischargeDebug;
}

export interface SmartDischargeDebug {
  exitReason?: string;
  candidateCount?: number;
  extraChargeBudget?: number;
  extraChargeBudgetAfterBackfill?: number;
  constraintCount?: number;
  constraintDeadlines?: Array<{ deadlineMs: number; deadlineISO: string; targetSoc: number }>;
  plannedChargeKeys?: string[];
  candidateResults?: Array<{
    key: string;
    price: number;
    exportPrice: number;
    effectiveExportPrice: number;
    marginalCost: number | null;
    rejected: 'backfill' | 'floor' | 'value' | 'marginal_cost' | null;
  }>;
}

export function buildSmartDischargePlan(
  rates: AgileRate[],
  settings: AppSettings,
  plannedChargeWindows: ChargeWindow[],
  fixedDischargeWindows: ChargeWindow[],
  context: PlanningContext = {},
  exportRates?: AgileRate[],
  pvForecast?: Array<{ valid_from: string; pv_estimate_w: number }>,
): SmartDischargePlan {
  const debug: SmartDischargeDebug = {};
  const empty = (reason: string): SmartDischargePlan => {
    debug.exitReason = reason;
    return { extraChargeWindows: [], dischargeWindows: [], _debug: debug };
  };

  if (settings.smart_discharge !== 'true') {
    return empty(`smart_discharge=${settings.smart_discharge}`);
  }

  const currentSoc = context.currentSoc ?? null;
  if (currentSoc === null) {
    return empty('no currentSoc');
  }

  const reserveSoc = clampPercentage(parseFloat(settings.discharge_soc_floor));
  if (reserveSoc === null) {
    return empty('no reserveSoc');
  }

  const energy = resolveEnergyModel(settings);
  if (energy === null) {
    return empty('invalid energy model');
  }
  const economics = resolveDischargeEconomics();

  const now = context.now ?? new Date();
  const slots = buildSlotModels(rates, settings, now, exportRates, pvForecast);
  if (slots.length === 0) {
    return empty('no slots');
  }

  const plan: ActionPlan = {
    chargeKeys: flattenSlotKeys(plannedChargeWindows),
    dischargeKeys: flattenSlotKeys(fixedDischargeWindows),
    extraChargeKeys: new Set<string>(),
  };

  const constraints = buildTargetConstraints(slots, settings, context, now, plan.chargeKeys);
  const configuredChargeSlots = parseSlotBudget(settings.charge_hours);
  // Give the discharge planner its own charge budget independent of the
  // base selection.  The base planner picks the globally cheapest slots
  // (which may all land in the distant future), while the discharge
  // planner needs to add nearer-term charges to support profitable
  // discharge cycles (e.g. charge overnight at 3p → discharge at 25p).
  let extraChargeBudget = configuredChargeSlots;

  debug.constraintCount = constraints.length;
  debug.extraChargeBudget = extraChargeBudget;
  debug.constraintDeadlines = constraints.map((c) => ({
    deadlineMs: c.deadlineMs,
    deadlineISO: new Date(c.deadlineMs).toISOString(),
    targetSoc: c.targetSoc,
  }));
  debug.plannedChargeKeys = [...plan.chargeKeys].sort();

  const initialBackfill = backfillChargesForTargets(slots, plan, constraints, extraChargeBudget, currentSoc, energy);
  // If initial backfill fails (e.g. night-window SOC target can't be met
  // due to drain modelling, even though afternoon charges handle it), don't
  // block the entire planner — proceed with zero extra budget and let the
  // per-candidate floor + value checks gate individual discharge slots.
  extraChargeBudget = initialBackfill.feasible ? initialBackfill.remainingBudget : 0;
  debug.extraChargeBudgetAfterBackfill = extraChargeBudget;

  const dischargeFloorWh = percentageToWh(reserveSoc, energy.batteryCapacityWh);
  let currentSim = simulatePlan(slots, plan, currentSoc, energy, dischargeFloorWh);
  let currentValue = calculatePlanValue(plan, slots, energy, currentSim, economics);
  const smartDischargeKeys = new Set<string>();

  const candidates = slots
    .filter((slot) =>
      slot.dischargeCandidate &&
      !plan.chargeKeys.has(slot.key) &&
      !plan.dischargeKeys.has(slot.key),
    )
    .sort((a, b) => {
      if (b.exportPrice !== a.exportPrice) {
        return b.exportPrice - a.exportPrice;
      }
      if (b.rate.price_inc_vat !== a.rate.price_inc_vat) {
        return b.rate.price_inc_vat - a.rate.price_inc_vat;
      }
      return a.startMs - b.startMs;
    });

  debug.candidateCount = candidates.length;
  debug.candidateResults = [];

  for (const candidate of candidates) {
    const tentative = clonePlan(plan);
    tentative.dischargeKeys.add(candidate.key);

    const refill = backfillChargesForTargets(
      slots,
      tentative,
      constraints,
      extraChargeBudget,
      currentSoc,
      energy,
      candidate.startMs,
    );
    if (!refill.feasible) {
      debug.candidateResults.push({
        key: candidate.key,
        price: candidate.rate.price_inc_vat,
        exportPrice: candidate.exportPrice,
        effectiveExportPrice: effectiveDischargePrice(candidate.exportPrice, economics),
        marginalCost: null,
        rejected: 'backfill',
      });
      continue;
    }

    const simulation = simulatePlan(slots, tentative, currentSoc, energy, dischargeFloorWh);
    const simByKey = new Map(simulation.map((point) => [point.key, point]));
    // Gate discharge against the weighted average cost of purchased energy
    // still held in the battery (rather than just the nearest prior charge).
    const marginalCost = estimateStoredEnergyUnitCostBefore(
      tentative,
      slots,
      energy,
      candidate.startMs,
      simByKey,
    );
    const effectiveExportPrice = effectiveDischargePrice(candidate.exportPrice, economics);
    if (marginalCost > 0 && effectiveExportPrice <= marginalCost) {
      debug.candidateResults.push({
        key: candidate.key,
        price: candidate.rate.price_inc_vat,
        exportPrice: candidate.exportPrice,
        effectiveExportPrice,
        marginalCost,
        rejected: 'marginal_cost',
      });
      continue;
    }

    // Reject if the slot would discharge nothing (SOC already at floor)
    const candidateSim = simByKey.get(candidate.key);
    if (!candidateSim || candidateSim.actualDischargeWh <= 0) {
      debug.candidateResults.push({
        key: candidate.key,
        price: candidate.rate.price_inc_vat,
        exportPrice: candidate.exportPrice,
        effectiveExportPrice,
        marginalCost,
        rejected: 'floor',
      });
      continue;
    }

    const tentativeValue = calculatePlanValue(tentative, slots, energy, simulation, economics);
    if (tentativeValue <= currentValue) {
      debug.candidateResults.push({
        key: candidate.key,
        price: candidate.rate.price_inc_vat,
        exportPrice: candidate.exportPrice,
        effectiveExportPrice,
        marginalCost,
        rejected: 'value',
      });
      continue;
    }

    debug.candidateResults.push({
      key: candidate.key,
      price: candidate.rate.price_inc_vat,
      exportPrice: candidate.exportPrice,
      effectiveExportPrice,
      marginalCost,
      rejected: null,
    });
    plan.chargeKeys = tentative.chargeKeys;
    plan.dischargeKeys = tentative.dischargeKeys;
    plan.extraChargeKeys = tentative.extraChargeKeys;
    extraChargeBudget = refill.remainingBudget;
    currentValue = tentativeValue;
    currentSim = simulation;
    smartDischargeKeys.add(candidate.key);
  }

  // Bundle retry: the per-candidate greedy above charges each discharge
  // its share of a full refill charge slot, so a cluster of small
  // discharges that together cost less than one shared refill still get
  // rejected individually. Retry value-rejected candidates as a group.
  const rejectedByKey = new Map(
    (debug.candidateResults ?? []).map((r) => [r.key, r] as const),
  );
  const bundleCandidates = candidates.filter(
    (c) => rejectedByKey.get(c.key)?.rejected === 'value',
  );

  for (let size = bundleCandidates.length; size >= 2; size -= 1) {
    const bundle = bundleCandidates.slice(0, size);
    const earliestMs = Math.min(...bundle.map((b) => b.startMs));
    const tentative = clonePlan(plan);
    for (const c of bundle) tentative.dischargeKeys.add(c.key);

    const refill = backfillChargesForTargets(
      slots,
      tentative,
      constraints,
      extraChargeBudget,
      currentSoc,
      energy,
      earliestMs,
    );
    if (!refill.feasible) continue;

    const simulation = simulatePlan(slots, tentative, currentSoc, energy, dischargeFloorWh);
    const simByKey = new Map(simulation.map((point) => [point.key, point]));

    let bundleOk = true;
    for (const c of bundle) {
      const marginalCost = estimateStoredEnergyUnitCostBefore(
        tentative,
        slots,
        energy,
        c.startMs,
        simByKey,
      );
      const eff = effectiveDischargePrice(c.exportPrice, economics);
      if (marginalCost > 0 && eff <= marginalCost) {
        bundleOk = false;
        break;
      }
      const point = simByKey.get(c.key);
      if (!point || point.actualDischargeWh <= 0) {
        bundleOk = false;
        break;
      }
    }
    if (!bundleOk) continue;

    const tentativeValue = calculatePlanValue(tentative, slots, energy, simulation, economics);
    if (tentativeValue <= currentValue) continue;

    plan.chargeKeys = tentative.chargeKeys;
    plan.dischargeKeys = tentative.dischargeKeys;
    plan.extraChargeKeys = tentative.extraChargeKeys;
    extraChargeBudget = refill.remainingBudget;
    currentValue = tentativeValue;
    currentSim = simulation;
    for (const c of bundle) {
      smartDischargeKeys.add(c.key);
      const entry = rejectedByKey.get(c.key);
      if (entry) entry.rejected = null;
    }
    break;
  }

  return {
    extraChargeWindows: slotsToWindows(slots, plan.extraChargeKeys),
    dischargeWindows: slotsToWindows(slots, smartDischargeKeys, 'discharge'),
    _debug: debug,
  };
}

export function findSmartDischargeSlots(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  return buildSmartDischargePlan(
    rates,
    settings,
    [],
    [],
    context,
    context.exportRates,
    context.pvForecast,
  ).dischargeWindows;
}

export function calculateDischargeSlotsAvailable(
  currentSoc: number,
  reserveSoc: number,
  settings: Pick<AppSettings, 'battery_capacity_kwh' | 'max_charge_power_kw' | 'estimated_consumption_w'>,
  now: Date = new Date(),
): number {
  const batteryCapacityKwh = parseFloat(settings.battery_capacity_kwh);
  const fallbackConsumptionW = parseFloat(settings.estimated_consumption_w) || 0;

  if (!Number.isFinite(batteryCapacityKwh) || batteryCapacityKwh <= 0) {
    return 0;
  }

  // Use the 24h-forward forecast average when the usage profile is available —
  // a flat figure over-estimates available slots when a consumption peak is
  // imminent. Falls back to estimated_consumption_w when the profile is empty
  // or learning is disabled (handled inside the repository).
  const horizonMs = now.getTime() + 24 * 60 * 60 * 1000;
  const forecastedConsumptionW = getAverageForecastedConsumptionW(
    now.getTime(),
    horizonMs,
    fallbackConsumptionW,
  );

  const availableEnergyKwh = batteryCapacityKwh * ((currentSoc - reserveSoc) / 100);
  const energyPerSlotKwh = (forecastedConsumptionW / 1000) * HALF_HOUR_HOURS;

  if (availableEnergyKwh <= 0 || energyPerSlotKwh <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(availableEnergyKwh / energyPerSlotKwh));
}

function buildSlotModels(
  rates: AgileRate[],
  settings: AppSettings,
  now: Date,
  exportRates?: AgileRate[],
  pvForecast?: Array<{ valid_from: string; pv_estimate_w: number }>,
): SlotModel[] {
  const strategy = getChargingStrategy(settings);
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const dischargePriceThreshold = parseFloat(settings.discharge_price_threshold) || 0;
  const peakStart = settings.peak_period_start || '16:00';
  const peakEnd = settings.peak_period_end || '19:00';

  // Build export rate lookup — falls back to import rate when absent.
  // Non-positive export prices (e.g. synthetic 0.0 placeholders when the user
  // has no Outgoing tariff) are skipped so the `??` fallback below picks up
  // the avoided-import value. Without this filter, the arbitrage gate rejects
  // every slot because effectiveDischargePrice(0, _) < marginalCost.
  const exportRateMap = new Map<string, number>();
  if (exportRates) {
    for (const er of exportRates) {
      if (Number.isFinite(er.price_inc_vat) && er.price_inc_vat > 0) {
        exportRateMap.set(er.valid_from, er.price_inc_vat);
      }
    }
  }

  // Build PV forecast lookup (watts → Wh for a 30-min slot)
  const pvMap = new Map<string, number>();
  if (pvForecast) {
    for (const pv of pvForecast) {
      pvMap.set(pv.valid_from, pv.pv_estimate_w * 0.5);
    }
  }

  return [...rates]
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from))
    .filter((rate) => new Date(rate.valid_to).getTime() > now.getTime())
    .map((rate) => {
      const startMs = new Date(rate.valid_from).getTime();
      const endMs = new Date(rate.valid_to).getTime();
      const passesChargeThreshold = priceThreshold <= 0 || rate.price_inc_vat <= priceThreshold;
      const exportPrice = exportRateMap.get(rate.valid_from) ?? rate.price_inc_vat;

      return {
        key: rate.valid_from,
        rate,
        exportPrice,
        pvEstimateWh: pvMap.get(rate.valid_from) ?? 0,
        startMs,
        endMs,
        baseChargeCandidate: isEligibleRate(rate, settings, strategy, now) && passesChargeThreshold,
        peakChargeCandidate:
          !isInChargeWindow(rate.valid_from, peakStart, peakEnd) &&
          passesChargeThreshold,
        dischargeCandidate:
          dischargePriceThreshold <= 0 || exportPrice >= dischargePriceThreshold,
      };
    });
}

function buildTargetConstraints(
  slots: SlotModel[],
  settings: AppSettings,
  context: PlanningContext,
  now: Date,
  _plannedChargeKeys?: Set<string>,
): TargetConstraint[] {
  const constraints: TargetConstraint[] = [];
  const currentSoc = context.currentSoc ?? null;
  if (currentSoc === null) return constraints;

  // NOTE: min_soc_target is intentionally NOT a discharge constraint.
  // It is a *charging* target — findCheapestSlots and peak-prep already
  // ensure the battery charges to that level.  The discharge_soc_floor
  // (enforced by respectsDischargeFloor) is the correct lower bound for
  // discharge decisions.  Including min_soc_target here would force the
  // planner to maintain that SOC through the entire horizon, making
  // discharge impossible in most scenarios.

  if (settings.peak_protection === 'true') {
    const peakTarget = clampPercentage(parseFloat(settings.peak_soc_target));
    const peakStart = settings.peak_period_start || '16:00';
    const peakEnd = settings.peak_period_end || '19:00';
    const nextPeakSlot = slots.find((slot) => {
      if (slot.endMs <= now.getTime()) return false;
      return isInChargeWindow(slot.rate.valid_from, peakStart, peakEnd);
    });

    if (nextPeakSlot && peakTarget !== null && peakTarget > currentSoc) {
      constraints.push({
        deadlineMs: nextPeakSlot.startMs,
        targetSoc: peakTarget,
        canUseCharge: (slot) =>
          slot.peakChargeCandidate &&
          slot.endMs <= nextPeakSlot.startMs &&
          slot.startMs < nextPeakSlot.startMs,
      });
    }
  }

  return constraints.sort((a, b) => a.deadlineMs - b.deadlineMs);
}

function backfillChargesForTargets(
  slots: SlotModel[],
  plan: ActionPlan,
  constraints: TargetConstraint[],
  remainingBudget: number,
  currentSoc: number,
  energy: EnergyModel,
  /** When set, skip constraints whose deadline is before this time —
   *  a discharge after the deadline cannot affect the SOC at it. */
  onlyAfterMs?: number,
): { feasible: boolean; remainingBudget: number } {
  for (const constraint of constraints) {
    // A discharge that starts after a constraint's deadline cannot lower
    // the SOC at that deadline, so the constraint is unaffected.
    if (onlyAfterMs !== undefined && constraint.deadlineMs <= onlyAfterMs) {
      continue;
    }

    while (socAtDeadline(simulatePlan(slots, plan, currentSoc, energy), constraint.deadlineMs, currentSoc, energy.batteryCapacityWh) < constraint.targetSoc) {
      if (remainingBudget <= 0) {
        return { feasible: false, remainingBudget };
      }

      const candidate = slots
        .filter((slot) =>
          constraint.canUseCharge(slot) &&
          !plan.chargeKeys.has(slot.key) &&
          !plan.dischargeKeys.has(slot.key),
        )
        .sort((a, b) => {
          if (a.rate.price_inc_vat !== b.rate.price_inc_vat) {
            return a.rate.price_inc_vat - b.rate.price_inc_vat;
          }
          return a.startMs - b.startMs;
        })[0];

      if (!candidate) {
        return { feasible: false, remainingBudget };
      }

      plan.chargeKeys.add(candidate.key);
      plan.extraChargeKeys.add(candidate.key);
      remainingBudget -= 1;
    }
  }

  return { feasible: true, remainingBudget };
}

function simulatePlan(
  slots: SlotModel[],
  plan: ActionPlan,
  currentSoc: number,
  energy: EnergyModel,
  dischargeFloorWh: number = 0,
): SimulationPoint[] {
  let socWh = percentageToWh(currentSoc, energy.batteryCapacityWh);
  const points: SimulationPoint[] = [];

  for (const slot of slots) {
    const pvWh = slot.pvEstimateWh;
    // Per-slot drain lookup: when the usage profile is available this varies
    // slot-by-slot; otherwise it collapses to the flat fallback.
    const drainWh = energy.drainWhAtMs(slot.startMs);
    let actualDischargeWh = 0;
    let actualChargeWh = 0;

    if (plan.chargeKeys.has(slot.key)) {
      // Grid charge only fills remaining headroom — once the battery is at
      // capacity the inverter stops drawing from the grid, so the paid
      // energy is capped even though the slot is still marked 'charge'.
      const headroomWh = Math.max(0, energy.batteryCapacityWh - socWh);
      actualChargeWh = Math.min(energy.chargePerSlotWh, headroomWh);
      // PV surplus after covering consumption fills any remaining headroom.
      const addWh = energy.chargePerSlotWh + Math.max(0, pvWh - drainWh);
      socWh = Math.min(energy.batteryCapacityWh, socWh + addWh);
    } else if (plan.dischargeKeys.has(slot.key)) {
      // Load-following: PV offsets consumption, battery covers the rest.
      // Existing approximation: battery output rate = house load (drainWh).
      if (pvWh >= drainWh) {
        // PV covers all consumption; surplus charges battery
        socWh = Math.min(energy.batteryCapacityWh, socWh + (pvWh - drainWh));
      } else {
        const netDrain = drainWh - pvWh;
        const available = Math.max(0, socWh - dischargeFloorWh);
        actualDischargeWh = Math.min(netDrain, available);
        socWh -= actualDischargeWh;
      }
    } else {
      // Hold: inverter prevents grid discharge so consumption comes
      // from the grid, not the battery.  PV surplus still charges.
      if (pvWh > drainWh) {
        socWh = Math.min(energy.batteryCapacityWh, socWh + (pvWh - drainWh));
      }
    }

    points.push({
      key: slot.key,
      endMs: slot.endMs,
      socAfterWh: socWh,
      actualDischargeWh,
      actualChargeWh,
    });
  }

  return points;
}

function socAtDeadline(
  simulation: SimulationPoint[],
  deadlineMs: number,
  currentSoc: number,
  batteryCapacityWh: number,
): number {
  const point = simulation.findLast((entry) => entry.endMs <= deadlineMs);
  if (!point) return currentSoc;
  return (point.socAfterWh / batteryCapacityWh) * 100;
}

function calculatePlanValue(
  plan: ActionPlan,
  slots: SlotModel[],
  energy: EnergyModel,
  simulation?: SimulationPoint[],
  economics: DischargeEconomics = resolveDischargeEconomics(),
): number {
  let total = 0;
  const simByKey = simulation ? new Map(simulation.map((p) => [p.key, p])) : null;

  for (const slot of slots) {
    if (plan.chargeKeys.has(slot.key)) {
      // Cost only the grid energy the battery could actually accept — a
      // slot that caps at full SOC draws nothing from the grid.
      const chargeWh =
        simByKey?.get(slot.key)?.actualChargeWh ?? energy.chargePerSlotWh;
      total -= (chargeWh / 1000) * slot.rate.price_inc_vat;
    } else if (plan.dischargeKeys.has(slot.key)) {
      // Use actual discharge from simulation (supports partial discharge
      // when SOC is near the floor), falling back to the per-slot drain
      // (preserves the "battery output = house load" approximation).
      const dischargeWh =
        simByKey?.get(slot.key)?.actualDischargeWh ?? energy.drainWhAtMs(slot.startMs);
      total += (dischargeWh / 1000) * effectiveDischargePrice(slot.exportPrice, economics);
    }
  }

  return total;
}

function slotsToWindows(
  slots: SlotModel[],
  keys: Set<string>,
  type?: 'charge' | 'discharge',
): ChargeWindow[] {
  const selected = slots
    .filter((slot) => keys.has(slot.key))
    .map((slot) => slot.rate);

  if (selected.length === 0) return [];
  return mergeAdjacentSlots(selected, type);
}

function flattenSlotKeys(windows: ChargeWindow[]): Set<string> {
  const keys = new Set<string>();
  for (const window of windows) {
    for (const slot of window.slots) {
      keys.add(slot.valid_from);
    }
  }
  return keys;
}

function clonePlan(plan: ActionPlan): ActionPlan {
  return {
    chargeKeys: new Set(plan.chargeKeys),
    dischargeKeys: new Set(plan.dischargeKeys),
    extraChargeKeys: new Set(plan.extraChargeKeys),
  };
}

function resolveEnergyModel(settings: Pick<AppSettings, 'battery_capacity_kwh' | 'max_charge_power_kw' | 'charge_rate' | 'estimated_consumption_w'>): EnergyModel | null {
  const batteryCapacityWh = (parseFloat(settings.battery_capacity_kwh) || 0) * 1000;
  const maxChargePowerW = (parseFloat(settings.max_charge_power_kw) || 0) * 1000;
  const chargeRate = parseFloat(settings.charge_rate);
  const estimatedConsumptionW = parseFloat(settings.estimated_consumption_w) || 0;
  const effectiveChargePowerW = maxChargePowerW * ((Number.isFinite(chargeRate) ? chargeRate : 100) / 100);

  if (batteryCapacityWh <= 0 || effectiveChargePowerW <= 0) {
    return null;
  }

  const fallbackDrainPerSlotWh = estimatedConsumptionW * HALF_HOUR_HOURS;
  return {
    batteryCapacityWh,
    chargePerSlotWh: effectiveChargePowerW * HALF_HOUR_HOURS,
    drainWhAtMs: (startMs: number) => {
      const forecastW = getForecastedConsumptionW(new Date(startMs), estimatedConsumptionW);
      return forecastW * HALF_HOUR_HOURS;
    },
    fallbackDrainPerSlotWh,
  };
}

function estimateStoredEnergyUnitCostBefore(
  plan: ActionPlan,
  slots: SlotModel[],
  energy: EnergyModel,
  beforeMs: number,
  simulationByKey: Map<string, SimulationPoint>,
): number {
  let storedPurchasedKwh = 0;
  let storedPurchasedCostPence = 0;

  for (const slot of slots) {
    if (slot.endMs > beforeMs) {
      break;
    }

    if (plan.chargeKeys.has(slot.key)) {
      const actualChargeWh =
        simulationByKey.get(slot.key)?.actualChargeWh ?? energy.chargePerSlotWh;
      const chargedKwh = actualChargeWh / 1000;
      if (chargedKwh <= 0) continue;
      storedPurchasedKwh += chargedKwh;
      storedPurchasedCostPence += chargedKwh * slot.rate.price_inc_vat;
      continue;
    }

    if (!plan.dischargeKeys.has(slot.key) || storedPurchasedKwh <= 0) {
      continue;
    }

    const dischargedWh =
      simulationByKey.get(slot.key)?.actualDischargeWh ?? energy.drainWhAtMs(slot.startMs);
    const dischargedKwh = Math.max(0, dischargedWh / 1000);
    if (dischargedKwh <= 0) continue;

    const consumedPurchasedKwh = Math.min(dischargedKwh, storedPurchasedKwh);
    const currentUnitCost = storedPurchasedCostPence / storedPurchasedKwh;
    storedPurchasedKwh -= consumedPurchasedKwh;
    storedPurchasedCostPence -= consumedPurchasedKwh * currentUnitCost;
  }

  if (storedPurchasedKwh <= 0) return 0;
  return storedPurchasedCostPence / storedPurchasedKwh;
}

function percentageToWh(percentage: number, batteryCapacityWh: number): number {
  return batteryCapacityWh * (percentage / 100);
}

function resolveDischargeEconomics(): DischargeEconomics {
  return {
    dischargeEfficiency: DEFAULT_DISCHARGE_EFFICIENCY,
    batteryWearPencePerKwh: DEFAULT_BATTERY_WEAR_PENCE_PER_KWH,
  };
}

function effectiveDischargePrice(exportPrice: number, economics: DischargeEconomics): number {
  return (exportPrice * economics.dischargeEfficiency) - economics.batteryWearPencePerKwh;
}

function clampPercentage(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}
