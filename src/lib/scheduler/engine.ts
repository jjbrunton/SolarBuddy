import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import { type PlanAction } from '../plan-actions';
import { computeSOCForecast } from '../soc-forecast';
import { buildSmartDischargePlan } from './discharge';
import { findNegativePriceSlots, findPreDischargeSlots } from './negative';
import { findPeakPrepSlots } from './peak';

const SCHEDULER_TIME_ZONE = 'Europe/London';
const HALF_HOUR_HOURS = 0.5;
const schedulerTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULER_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type ChargingStrategy = 'night_fill' | 'opportunistic_topup';

export interface ChargeWindow {
  slot_start: string;
  slot_end: string;
  avg_price: number;
  slots: AgileRate[];
  type?: 'charge' | 'discharge';
}

export interface PlanningContext {
  currentSoc?: number | null;
  now?: Date;
}

export interface PlannedSlot {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string;
  expected_soc_after: number | null;
  expected_value: number | null;
}

export interface SchedulePlan {
  windows: ChargeWindow[];
  slots: PlannedSlot[];
}

export function getChargingStrategy(settings: Pick<AppSettings, 'charging_strategy'>): ChargingStrategy {
  return settings.charging_strategy === 'opportunistic_topup' ? 'opportunistic_topup' : 'night_fill';
}

export function findCheapestSlots(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const strategy = getChargingStrategy(settings);
  const now = context.now ?? new Date();
  const slotBudget = resolveSlotBudget(settings, context.currentSoc ?? null);

  if (slotBudget <= 0) return [];

  const eligible = rates.filter((rate) => isEligibleRate(rate, settings, strategy, now));

  if (eligible.length === 0) return [];

  const sortedByPrice = [...eligible].sort((a, b) => a.price_inc_vat - b.price_inc_vat);
  const selected =
    priceThreshold > 0
      ? sortedByPrice.filter((rate) => rate.price_inc_vat <= priceThreshold).slice(0, slotBudget)
      : sortedByPrice.slice(0, slotBudget);

  if (selected.length === 0) return [];

  // Sort selected slots by time and merge adjacent ones
  selected.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(selected);
}

export function calculateSlotsNeeded(
  currentSoc: number,
  targetSoc: number,
  settings: Pick<AppSettings, 'battery_capacity_kwh' | 'max_charge_power_kw' | 'charge_rate'>,
): number {
  const batteryCapacityKwh = parseFloat(settings.battery_capacity_kwh);
  const maxChargePowerKw = parseFloat(settings.max_charge_power_kw);
  const chargeRate = parseFloat(settings.charge_rate);
  const effectiveChargePowerKw = maxChargePowerKw * ((Number.isFinite(chargeRate) ? chargeRate : 100) / 100);

  if (!Number.isFinite(batteryCapacityKwh) || batteryCapacityKwh <= 0 || !Number.isFinite(effectiveChargePowerKw) || effectiveChargePowerKw <= 0) {
    return 0;
  }

  const requiredEnergyKwh = batteryCapacityKwh * ((targetSoc - currentSoc) / 100);
  const energyPerSlotKwh = effectiveChargePowerKw * HALF_HOUR_HOURS;

  if (requiredEnergyKwh <= 0 || energyPerSlotKwh <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(requiredEnergyKwh / energyPerSlotKwh));
}

function resolveSlotBudget(settings: AppSettings, currentSoc: number | null): number {
  const configuredSlots = Math.max(1, parseInt(settings.charge_hours, 10) || 4);

  if (currentSoc === null) {
    return configuredSlots;
  }

  const targetSoc = clampPercentage(parseFloat(settings.min_soc_target));
  if (targetSoc === null || currentSoc >= targetSoc) {
    return 0;
  }

  const slotsNeeded = calculateSlotsNeeded(currentSoc, targetSoc, settings);
  if (slotsNeeded === 0) {
    return configuredSlots;
  }

  return Math.min(configuredSlots, slotsNeeded);
}

function clampPercentage(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}

export function isEligibleRate(
  rate: AgileRate,
  settings: AppSettings,
  strategy: ChargingStrategy,
  now: Date,
): boolean {
  if (strategy === 'opportunistic_topup') {
    return new Date(rate.valid_to).getTime() > now.getTime();
  }

  const windowStart = settings.charge_window_start || '23:00';
  const windowEnd = settings.charge_window_end || '07:00';
  return isInChargeWindow(rate.valid_from, windowStart, windowEnd);
}

export function isInChargeWindow(validFrom: string, windowStart: string, windowEnd: string): boolean {
  const { hours, minutes } = getSchedulerLocalTime(validFrom);
  const time = hours * 60 + minutes;

  const [startH, startM] = windowStart.split(':').map(Number);
  const [endH, endM] = windowEnd.split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  if (start > end) {
    // Overnight window (e.g. 23:00 to 07:00)
    return time >= start || time < end;
  }
  return time >= start && time < end;
}

export function getSchedulerLocalTime(validFrom: string) {
  const parts = schedulerTimeFormatter.formatToParts(new Date(validFrom));
  const hourPart = parts.find((part) => part.type === 'hour')?.value;
  const minutePart = parts.find((part) => part.type === 'minute')?.value;

  return {
    hours: Number(hourPart ?? '0'),
    minutes: Number(minutePart ?? '0'),
  };
}

export function mergeAdjacentSlots(slots: AgileRate[], type?: 'charge' | 'discharge'): ChargeWindow[] {
  if (slots.length === 0) return [];

  const windows: ChargeWindow[] = [];
  let currentSlots: AgileRate[] = [slots[0]];

  for (let i = 1; i < slots.length; i++) {
    const prev = currentSlots[currentSlots.length - 1];
    const curr = slots[i];

    if (prev.valid_to === curr.valid_from) {
      currentSlots.push(curr);
    } else {
      windows.push(createWindow(currentSlots, type));
      currentSlots = [curr];
    }
  }

  windows.push(createWindow(currentSlots, type));
  return windows;
}

function createWindow(slots: AgileRate[], type?: 'charge' | 'discharge'): ChargeWindow {
  const totalPrice = slots.reduce((sum, s) => sum + s.price_inc_vat, 0);
  return {
    slot_start: slots[0].valid_from,
    slot_end: slots[slots.length - 1].valid_to,
    avg_price: totalPrice / slots.length,
    slots,
    ...(type ? { type } : {}),
  };
}

// --- Composable charge plan ---

export function buildChargePlan(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  return buildSchedulePlan(rates, settings, context).windows;
}

export function buildSchedulePlan(
  rates: AgileRate[],
  settings: AppSettings,
  context: PlanningContext = {},
): SchedulePlan {
  const now = context.now ?? new Date();
  const baseWindows = findCheapestSlots(rates, settings, context);
  const negativeWindows = findNegativePriceSlots(rates, settings);
  const preDischargeWindows = findPreDischargeSlots(rates, negativeWindows, settings);
  const peakPrepWindows = findPeakPrepSlots(rates, settings, context);
  const smartDischargePlan = buildSmartDischargePlan(
    rates,
    settings,
    [...baseWindows, ...negativeWindows, ...peakPrepWindows],
    preDischargeWindows,
    context,
  );

  const windows = deduplicateAndMerge([
    ...baseWindows,
    ...negativeWindows,
    ...smartDischargePlan.extraChargeWindows,
    ...peakPrepWindows,
  ], [
    ...preDischargeWindows,
    ...smartDischargePlan.dischargeWindows,
  ]);

  return {
    windows,
    slots: buildPlannedSlots(rates, windows, {
      now,
      currentSoc: context.currentSoc ?? null,
      settings,
      sourceKeys: {
        negativeCharge: flattenWindowSlotKeys(negativeWindows),
        peakCharge: flattenWindowSlotKeys(peakPrepWindows),
        extraCharge: flattenWindowSlotKeys(smartDischargePlan.extraChargeWindows),
        preDischarge: flattenWindowSlotKeys(preDischargeWindows),
        smartDischarge: flattenWindowSlotKeys(smartDischargePlan.dischargeWindows),
      },
    }),
  };
}

export function deduplicateAndMerge(
  chargeWindows: ChargeWindow[],
  dischargeWindows: ChargeWindow[] = [],
): ChargeWindow[] {
  const chargeSlotMap = new Map<string, AgileRate>();
  for (const w of chargeWindows) {
    for (const slot of w.slots) {
      chargeSlotMap.set(slot.valid_from, slot);
    }
  }

  const chargeSlots = [...chargeSlotMap.values()].sort((a, b) =>
    a.valid_from.localeCompare(b.valid_from),
  );

  const merged = mergeAdjacentSlots(chargeSlots);

  const dischargeSlotMap = new Map<string, AgileRate>();
  for (const dw of dischargeWindows) {
    for (const slot of dw.slots) {
      if (!chargeSlotMap.has(slot.valid_from)) {
        dischargeSlotMap.set(slot.valid_from, slot);
      }
    }
  }

  const dischargeSlots = [...dischargeSlotMap.values()].sort((a, b) =>
    a.valid_from.localeCompare(b.valid_from),
  );
  const mergedDischarge = mergeAdjacentSlots(dischargeSlots, 'discharge');

  return [...mergedDischarge, ...merged].sort((a, b) =>
    a.slot_start.localeCompare(b.slot_start),
  );
}

function buildPlannedSlots(
  rates: AgileRate[],
  windows: ChargeWindow[],
  {
    now,
    currentSoc,
    settings,
    sourceKeys,
  }: {
    now: Date;
    currentSoc: number | null;
    settings: AppSettings;
    sourceKeys: {
      negativeCharge: Set<string>;
      peakCharge: Set<string>;
      extraCharge: Set<string>;
      preDischarge: Set<string>;
      smartDischarge: Set<string>;
    };
  },
): PlannedSlot[] {
  const futureRates = [...rates]
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from))
    .filter((rate) => new Date(rate.valid_to).getTime() > now.getTime());

  const chargeKeys = new Set<string>();
  const dischargeKeys = new Set<string>();
  for (const window of windows) {
    for (const slot of window.slots) {
      if (window.type === 'discharge') {
        dischargeKeys.add(slot.valid_from);
      } else {
        chargeKeys.add(slot.valid_from);
      }
    }
  }

  const actions: PlanAction[] = futureRates.map((rate) => {
    if (chargeKeys.has(rate.valid_from)) return 'charge' as const;
    if (dischargeKeys.has(rate.valid_from)) return 'discharge' as const;
    return 'do_nothing' as const;
  });

  const holdIndices = deriveHoldIndices(futureRates, actions);
  const strategicHoldKeys = new Set<string>(
    [...holdIndices].map((index) => futureRates[index]?.valid_from).filter((value): value is string => Boolean(value)),
  );

  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index] === 'do_nothing') {
      actions[index] = 'hold';
    }
  }

  const slotActions = new Map<number, PlanAction>();
  actions.forEach((action, index) => {
    if (action !== 'do_nothing') {
      slotActions.set(index, action);
    }
  });

  const expectedSocAfter =
    currentSoc === null
      ? futureRates.map(() => null)
      : computeSOCForecast({
          currentSOC: currentSoc,
          currentSlotIndex: 0,
          slotActions,
          totalSlots: futureRates.length,
          chargeRatePercent: parseFloat(settings.charge_rate) || 100,
          batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
          maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
          estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
        }).map((value) => Math.round(value * 10) / 10);

  const perSlotEnergyKwh = ((parseFloat(settings.max_charge_power_kw) || 3.6) * ((parseFloat(settings.charge_rate) || 100) / 100)) * HALF_HOUR_HOURS;

  return futureRates.map((rate, index) => {
    const action = actions[index];
    let expectedValue: number | null = null;

    if (action === 'charge') {
      expectedValue = Math.round(-perSlotEnergyKwh * rate.price_inc_vat * 100) / 100;
    } else if (action === 'discharge') {
      expectedValue = Math.round(perSlotEnergyKwh * rate.price_inc_vat * 100) / 100;
    }

    return {
      slot_start: rate.valid_from,
      slot_end: rate.valid_to,
      action,
      reason: describePlannedAction(action, rate.valid_from, sourceKeys, strategicHoldKeys),
      expected_soc_after: expectedSocAfter[index],
      expected_value: expectedValue,
    };
  });
}

function flattenWindowSlotKeys(windows: ChargeWindow[]): Set<string> {
  const keys = new Set<string>();
  for (const window of windows) {
    for (const slot of window.slots) {
      keys.add(slot.valid_from);
    }
  }
  return keys;
}

function deriveHoldIndices(rates: AgileRate[], actions: PlanAction[]): Set<number> {
  const holdIndices = new Set<number>();
  const chargeIndices = new Set<number>();
  const dischargeIndices: number[] = [];

  actions.forEach((action, index) => {
    if (action === 'charge') {
      chargeIndices.add(index);
    } else if (action === 'discharge') {
      dischargeIndices.push(index);
    }
  });

  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index] !== 'do_nothing') continue;

    const nextDischarge = dischargeIndices.find((candidateIndex) => candidateIndex > index);
    if (nextDischarge === undefined) continue;

    const hasChargeBeforeNextDischarge = [...chargeIndices].some((candidateIndex) =>
      candidateIndex > index && candidateIndex < nextDischarge,
    );
    if (hasChargeBeforeNextDischarge) continue;

    if (rates[index].price_inc_vat < rates[nextDischarge].price_inc_vat) {
      holdIndices.add(index);
    }
  }

  return holdIndices;
}

function describePlannedAction(
  action: PlanAction,
  slotStart: string,
  sourceKeys: {
    negativeCharge: Set<string>;
    peakCharge: Set<string>;
    extraCharge: Set<string>;
    preDischarge: Set<string>;
    smartDischarge: Set<string>;
  },
  strategicHoldKeys: Set<string>,
): string {
  if (action === 'charge') {
    if (sourceKeys.negativeCharge.has(slotStart)) {
      return 'Negative-price charge slot.';
    }
    if (sourceKeys.extraCharge.has(slotStart)) {
      return 'Cheap recharge slot added to keep a later discharge or SOC target feasible.';
    }
    if (sourceKeys.peakCharge.has(slotStart)) {
      return 'Pre-charge slot selected for peak protection.';
    }
    return 'Charge slot selected by the planner.';
  }

  if (action === 'discharge') {
    if (sourceKeys.preDischarge.has(slotStart)) {
      return 'Pre-discharge slot reserved before a negative-price charging window.';
    }
    if (sourceKeys.smartDischarge.has(slotStart)) {
      return 'Discharge slot selected by the arbitrage planner.';
    }
    return 'Discharge slot selected by the planner.';
  }

  if (action === 'hold') {
    if (strategicHoldKeys.has(slotStart)) {
      return 'Hold battery for a better discharge opportunity later in the tariff horizon.';
    }

    return 'Hold battery and prevent discharge in this slot.';
  }

  return 'No forced battery action planned for this slot.';
}
