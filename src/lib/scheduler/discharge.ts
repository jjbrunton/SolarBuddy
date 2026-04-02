import { AppSettings } from '../config';
import { AgileRate } from '../octopus/rates';
import {
  ChargeWindow,
  PlanningContext,
  getChargingStrategy,
  isEligibleRate,
  isInChargeWindow,
  mergeAdjacentSlots,
} from './engine';

const HALF_HOUR_HOURS = 0.5;

interface SlotModel {
  key: string;
  rate: AgileRate;
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
}

export function buildSmartDischargePlan(
  rates: AgileRate[],
  settings: AppSettings,
  plannedChargeWindows: ChargeWindow[],
  fixedDischargeWindows: ChargeWindow[],
  context: PlanningContext = {},
): SmartDischargePlan {
  if (settings.smart_discharge !== 'true') {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }

  const currentSoc = context.currentSoc ?? null;
  if (currentSoc === null) {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }

  const reserveSoc = clampPercentage(parseFloat(settings.discharge_soc_floor));
  if (reserveSoc === null || currentSoc <= reserveSoc) {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }

  const energy = resolveEnergyModel(settings);
  if (energy === null) {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }

  const now = context.now ?? new Date();
  const slots = buildSlotModels(rates, settings, now);
  if (slots.length === 0) {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }

  const plan: ActionPlan = {
    chargeKeys: flattenSlotKeys(plannedChargeWindows),
    dischargeKeys: flattenSlotKeys(fixedDischargeWindows),
    extraChargeKeys: new Set<string>(),
  };

  const constraints = buildTargetConstraints(slots, settings, context, now);
  const configuredChargeSlots = Math.max(1, parseInt(settings.charge_hours, 10) || 4);
  let extraChargeBudget = Math.max(0, configuredChargeSlots - plan.chargeKeys.size);

  const initialBackfill = backfillChargesForTargets(slots, plan, constraints, extraChargeBudget, currentSoc, energy);
  if (!initialBackfill.feasible) {
    return { extraChargeWindows: [], dischargeWindows: [] };
  }
  extraChargeBudget = initialBackfill.remainingBudget;

  let currentValue = calculatePlanValue(plan, slots, energy);
  const smartDischargeKeys = new Set<string>();
  const dischargeFloorWh = percentageToWh(reserveSoc, energy.batteryCapacityWh);

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
    );
    if (!refill.feasible) {
      continue;
    }

    const simulation = simulatePlan(slots, tentative, currentSoc, energy);
    if (!respectsDischargeFloor(simulation, tentative.dischargeKeys, dischargeFloorWh)) {
      continue;
    }

    const tentativeValue = calculatePlanValue(tentative, slots, energy);
    if (tentativeValue <= currentValue) {
      continue;
    }

    plan.chargeKeys = tentative.chargeKeys;
    plan.dischargeKeys = tentative.dischargeKeys;
    plan.extraChargeKeys = tentative.extraChargeKeys;
    extraChargeBudget = refill.remainingBudget;
    currentValue = tentativeValue;
    smartDischargeKeys.add(candidate.key);
  }

  return {
    extraChargeWindows: slotsToWindows(slots, plan.extraChargeKeys),
    dischargeWindows: slotsToWindows(slots, smartDischargeKeys, 'discharge'),
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
  settings: Pick<AppSettings, 'battery_capacity_kwh' | 'max_charge_power_kw'>,
): number {
  const batteryCapacityKwh = parseFloat(settings.battery_capacity_kwh);
  const maxDischargePowerKw = parseFloat(settings.max_charge_power_kw);

  if (!Number.isFinite(batteryCapacityKwh) || batteryCapacityKwh <= 0) {
    return 0;
  }
  if (!Number.isFinite(maxDischargePowerKw) || maxDischargePowerKw <= 0) {
    return 0;
  }

  const availableEnergyKwh = batteryCapacityKwh * ((currentSoc - reserveSoc) / 100);
  const energyPerSlotKwh = maxDischargePowerKw * HALF_HOUR_HOURS;

  if (availableEnergyKwh <= 0 || energyPerSlotKwh <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(availableEnergyKwh / energyPerSlotKwh));
}

function buildSlotModels(
  rates: AgileRate[],
  settings: AppSettings,
  now: Date,
): SlotModel[] {
  const strategy = getChargingStrategy(settings);
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const dischargePriceThreshold = parseFloat(settings.discharge_price_threshold) || 0;
  const peakStart = settings.peak_period_start || '16:00';
  const peakEnd = settings.peak_period_end || '19:00';

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
): TargetConstraint[] {
  const constraints: TargetConstraint[] = [];
  const currentSoc = context.currentSoc ?? null;
  if (currentSoc === null) return constraints;

  const targetSoc = clampPercentage(parseFloat(settings.min_soc_target));
  if (targetSoc !== null && targetSoc > currentSoc) {
    const strategy = getChargingStrategy(settings);
    const eligible = strategy === 'opportunistic_topup'
      ? slots
      : slots.filter((slot) => slot.baseChargeCandidate);
    const deadlineMs = eligible[eligible.length - 1]?.endMs;

    if (deadlineMs) {
      constraints.push({
        deadlineMs,
        targetSoc,
        canUseCharge: (slot) => slot.baseChargeCandidate && slot.endMs <= deadlineMs,
      });
    }
  }

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
): { feasible: boolean; remainingBudget: number } {
  for (const constraint of constraints) {
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
): SimulationPoint[] {
  let socWh = percentageToWh(currentSoc, energy.batteryCapacityWh);
  const points: SimulationPoint[] = [];

  for (const slot of slots) {
    if (plan.chargeKeys.has(slot.key)) {
      socWh = Math.min(energy.batteryCapacityWh, socWh + energy.chargePerSlotWh);
    } else if (plan.dischargeKeys.has(slot.key)) {
      socWh = Math.max(0, socWh - energy.dischargePerSlotWh);
    } else {
      socWh = Math.max(0, socWh - energy.drainPerSlotWh);
    }

    points.push({
      key: slot.key,
      endMs: slot.endMs,
      socAfterWh: socWh,
    });
  }

  return points;
}

function respectsDischargeFloor(
  simulation: SimulationPoint[],
  dischargeKeys: Set<string>,
  dischargeFloorWh: number,
): boolean {
  return simulation.every((point) =>
    !dischargeKeys.has(point.key) || point.socAfterWh >= dischargeFloorWh,
  );
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
): number {
  let total = 0;

  for (const slot of slots) {
    if (plan.chargeKeys.has(slot.key)) {
      total -= (energy.chargePerSlotWh / 1000) * slot.rate.price_inc_vat;
    } else if (plan.dischargeKeys.has(slot.key)) {
      total += (energy.dischargePerSlotWh / 1000) * slot.rate.price_inc_vat;
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
    dischargePerSlotWh: (effectiveChargePowerW + estimatedConsumptionW) * HALF_HOUR_HOURS,
    drainPerSlotWh: estimatedConsumptionW * HALF_HOUR_HOURS,
  };
}

function percentageToWh(percentage: number, batteryCapacityWh: number): number {
  return batteryCapacityWh * (percentage / 100);
}

function clampPercentage(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}
