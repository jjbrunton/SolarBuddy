import { AppSettings } from '../config';
import { AgileRate } from '../octopus/rates';
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
}

interface EnergyModel {
  batteryCapacityWh: number;
  chargePerSlotWh: number;
  dischargePerSlotWh: number;
  drainPerSlotWh: number;
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
  let currentValue = calculatePlanValue(plan, slots, energy, currentSim);
  const smartDischargeKeys = new Set<string>();

  const candidates = slots
    .filter((slot) =>
      slot.dischargeCandidate &&
      !plan.chargeKeys.has(slot.key) &&
      !plan.dischargeKeys.has(slot.key),
    )
    .sort((a, b) => {
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
      debug.candidateResults.push({ key: candidate.key, price: candidate.rate.price_inc_vat, rejected: 'backfill' });
      continue;
    }

    // Reject if the discharge export price doesn't cover the cost of the
    // energy most recently charged into the battery.  This prevents
    // economically questionable patterns like charge@14.74p → discharge@14.51p.
    const precedingCost = nearestPrecedingChargePrice(tentative, slots, candidate.startMs);
    if (precedingCost > 0 && candidate.exportPrice <= precedingCost) {
      debug.candidateResults.push({ key: candidate.key, price: candidate.rate.price_inc_vat, rejected: 'marginal_cost' });
      continue;
    }

    const simulation = simulatePlan(slots, tentative, currentSoc, energy, dischargeFloorWh);

    // Reject if the slot would discharge nothing (SOC already at floor)
    const candidateSim = simulation.find((p) => p.key === candidate.key);
    if (!candidateSim || candidateSim.actualDischargeWh <= 0) {
      debug.candidateResults.push({ key: candidate.key, price: candidate.rate.price_inc_vat, rejected: 'floor' });
      continue;
    }

    const tentativeValue = calculatePlanValue(tentative, slots, energy, simulation);
    if (tentativeValue <= currentValue) {
      debug.candidateResults.push({ key: candidate.key, price: candidate.rate.price_inc_vat, rejected: 'value' });
      continue;
    }

    debug.candidateResults.push({ key: candidate.key, price: candidate.rate.price_inc_vat, rejected: null });
    plan.chargeKeys = tentative.chargeKeys;
    plan.dischargeKeys = tentative.dischargeKeys;
    plan.extraChargeKeys = tentative.extraChargeKeys;
    extraChargeBudget = refill.remainingBudget;
    currentValue = tentativeValue;
    currentSim = simulation;
    smartDischargeKeys.add(candidate.key);
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
  return buildSmartDischargePlan(rates, settings, [], [], context).dischargeWindows;
}

export function calculateDischargeSlotsAvailable(
  currentSoc: number,
  reserveSoc: number,
  settings: Pick<AppSettings, 'battery_capacity_kwh' | 'max_charge_power_kw' | 'estimated_consumption_w'>,
): number {
  const batteryCapacityKwh = parseFloat(settings.battery_capacity_kwh);
  const estimatedConsumptionW = parseFloat(settings.estimated_consumption_w) || 0;

  if (!Number.isFinite(batteryCapacityKwh) || batteryCapacityKwh <= 0) {
    return 0;
  }

  const availableEnergyKwh = batteryCapacityKwh * ((currentSoc - reserveSoc) / 100);
  const energyPerSlotKwh = (estimatedConsumptionW / 1000) * HALF_HOUR_HOURS;

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

  // Build export rate lookup — falls back to import rate when absent
  const exportRateMap = new Map<string, number>();
  if (exportRates) {
    for (const er of exportRates) {
      exportRateMap.set(er.valid_from, er.price_inc_vat);
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

      return {
        key: rate.valid_from,
        rate,
        exportPrice: exportRateMap.get(rate.valid_from) ?? rate.price_inc_vat,
        pvEstimateWh: pvMap.get(rate.valid_from) ?? 0,
        startMs,
        endMs,
        baseChargeCandidate: isEligibleRate(rate, settings, strategy, now) && passesChargeThreshold,
        peakChargeCandidate:
          !isInChargeWindow(rate.valid_from, peakStart, peakEnd) &&
          passesChargeThreshold,
        dischargeCandidate:
          dischargePriceThreshold <= 0 || rate.price_inc_vat >= dischargePriceThreshold,
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
    let actualDischargeWh = 0;

    if (plan.chargeKeys.has(slot.key)) {
      // Grid charging + PV surplus after covering consumption
      const addWh = energy.chargePerSlotWh + Math.max(0, pvWh - energy.drainPerSlotWh);
      socWh = Math.min(energy.batteryCapacityWh, socWh + addWh);
    } else if (plan.dischargeKeys.has(slot.key)) {
      // Load-following: PV offsets consumption, battery covers the rest
      if (pvWh >= energy.drainPerSlotWh) {
        // PV covers all consumption; surplus charges battery
        socWh = Math.min(energy.batteryCapacityWh, socWh + (pvWh - energy.drainPerSlotWh));
      } else {
        const netDrain = energy.dischargePerSlotWh - pvWh;
        const available = Math.max(0, socWh - dischargeFloorWh);
        actualDischargeWh = Math.min(netDrain, available);
        socWh -= actualDischargeWh;
      }
    } else {
      // Hold: inverter prevents grid discharge so consumption comes
      // from the grid, not the battery.  PV surplus still charges.
      if (pvWh > energy.drainPerSlotWh) {
        socWh = Math.min(energy.batteryCapacityWh, socWh + (pvWh - energy.drainPerSlotWh));
      }
    }

    points.push({
      key: slot.key,
      endMs: slot.endMs,
      socAfterWh: socWh,
      actualDischargeWh,
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
): number {
  let total = 0;
  const simByKey = simulation ? new Map(simulation.map((p) => [p.key, p])) : null;

  for (const slot of slots) {
    if (plan.chargeKeys.has(slot.key)) {
      total -= (energy.chargePerSlotWh / 1000) * slot.rate.price_inc_vat;
    } else if (plan.dischargeKeys.has(slot.key)) {
      // Use actual discharge from simulation (supports partial discharge
      // when SOC is near the floor), falling back to full rate
      const dischargeWh = simByKey?.get(slot.key)?.actualDischargeWh ?? energy.dischargePerSlotWh;
      total += (dischargeWh / 1000) * slot.exportPrice;
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

  return {
    batteryCapacityWh,
    chargePerSlotWh: effectiveChargePowerW * HALF_HOUR_HOURS,
    dischargePerSlotWh: estimatedConsumptionW * HALF_HOUR_HOURS,
    drainPerSlotWh: estimatedConsumptionW * HALF_HOUR_HOURS,
  };
}

function percentageToWh(percentage: number, batteryCapacityWh: number): number {
  return batteryCapacityWh * (percentage / 100);
}

/**
 * Price (p/kWh) of the charge slot closest before (or at) a given time.
 * Returns 0 when no preceding charge exists — the energy predates the plan
 * horizon and is effectively free.
 */
function nearestPrecedingChargePrice(
  plan: ActionPlan,
  slots: SlotModel[],
  beforeMs: number,
): number {
  let best: SlotModel | null = null;
  for (const slot of slots) {
    if (!plan.chargeKeys.has(slot.key)) continue;
    if (slot.endMs > beforeMs) continue;
    if (!best || slot.startMs > best.startMs) {
      best = slot;
    }
  }
  return best?.rate.price_inc_vat ?? 0;
}

function clampPercentage(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}
