import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
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

function isEligibleRate(
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
  const baseWindows = findCheapestSlots(rates, settings, context);
  const negativeWindows = findNegativePriceSlots(rates, settings);
  const preDischargeWindows = findPreDischargeSlots(rates, negativeWindows, settings);
  const peakPrepWindows = findPeakPrepSlots(rates, settings, context);

  return deduplicateAndMerge([
    ...baseWindows,
    ...negativeWindows,
    ...peakPrepWindows,
  ], preDischargeWindows);
}

export function deduplicateAndMerge(
  chargeWindows: ChargeWindow[],
  dischargeWindows: ChargeWindow[] = [],
): ChargeWindow[] {
  // Flatten charge windows to individual slots, deduplicate by valid_from
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

  // Discharge windows are kept separate (don't merge with charge)
  // but remove any discharge slot that overlaps a charge slot
  const dischargeFiltered: ChargeWindow[] = [];
  for (const dw of dischargeWindows) {
    const nonOverlapping = dw.slots.filter((s) => !chargeSlotMap.has(s.valid_from));
    if (nonOverlapping.length > 0) {
      nonOverlapping.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
      dischargeFiltered.push(...mergeAdjacentSlots(nonOverlapping, 'discharge'));
    }
  }

  // Discharge windows go first (they happen before negative charge windows)
  return [...dischargeFiltered, ...merged].sort((a, b) =>
    a.slot_start.localeCompare(b.slot_start),
  );
}
