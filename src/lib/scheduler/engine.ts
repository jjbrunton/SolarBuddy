import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import { type PlanAction } from '../plan-actions';
import { computeSOCForecast } from '../soc-forecast';
import { buildSmartDischargePlan } from './discharge';
import { findAlwaysCheapSlots, findNegativePriceSlots, findNegativeRunDischargeSlots, findPreDischargeSlots } from './negative';
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

export interface PVForecastSlot {
  valid_from: string;
  valid_to: string;
  pv_estimate_w: number;
  pv_estimate10_w: number;
  pv_estimate90_w: number;
}

export interface PlanningContext {
  currentSoc?: number | null;
  now?: Date;
  exportRates?: AgileRate[];
  pvForecast?: PVForecastSlot[];
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
  _dischargeDebug?: import('./discharge').SmartDischargeDebug;
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

  let effectiveThreshold = priceThreshold;
  if (effectiveThreshold <= 0 && !Number.isFinite(slotBudget)) {
    // Unlimited slots with no explicit threshold: only charge below the
    // average rate so we don't charge at peak prices.
    effectiveThreshold = eligible.reduce((sum, r) => sum + r.price_inc_vat, 0) / eligible.length;
  }

  const selected =
    effectiveThreshold > 0
      ? sortedByPrice.filter((rate) => rate.price_inc_vat <= effectiveThreshold).slice(0, slotBudget)
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

export function parseSlotBudget(chargeHours: string): number {
  const parsed = parseInt(chargeHours, 10);
  if (parsed === 0) return Infinity;
  return Math.max(1, parsed || 4);
}

function resolveSlotBudget(settings: AppSettings, currentSoc: number | null): number {
  const configuredSlots = parseSlotBudget(settings.charge_hours);

  if (currentSoc === null) {
    return configuredSlots;
  }

  const targetSoc = clampPercentage(parseFloat(settings.min_soc_target));

  // When smart discharge is active the battery cycles through
  // charge-discharge patterns.  Always use the full configured budget
  // so the planner can pick enough cheap slots for the next cycle,
  // regardless of the current SOC.
  if (settings.smart_discharge === 'true' && targetSoc !== null && targetSoc > 0) {
    return configuredSlots;
  }

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

function filterSuppressedWindows(windows: ChargeWindow[], suppressedKeys: Set<string>): ChargeWindow[] {
  if (suppressedKeys.size === 0) return windows;

  const filtered: ChargeWindow[] = [];
  for (const w of windows) {
    const kept = w.slots.filter((s) => !suppressedKeys.has(s.valid_from));
    if (kept.length > 0) {
      kept.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
      filtered.push(...mergeAdjacentSlots(kept, w.type));
    }
  }
  return filtered;
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

// --- Solar forecast overnight charge skip ---

const schedulerDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function shouldSkipOvernightCharge(
  pvForecast: PVForecastSlot[] | undefined,
  settings: AppSettings,
  now: Date,
): boolean {
  if (settings.solar_skip_enabled !== 'true') return false;
  if (settings.pv_forecast_enabled !== 'true') return false;
  if (!pvForecast || pvForecast.length === 0) return false;

  const threshold = parseFloat(settings.solar_skip_threshold_kwh) || 15;

  // Determine tomorrow's date in scheduler timezone
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = schedulerDateFormatter.formatToParts(tomorrow);
  const tomorrowDay = tomorrowParts.find((p) => p.type === 'day')?.value;
  const tomorrowMonth = tomorrowParts.find((p) => p.type === 'month')?.value;
  const tomorrowYear = tomorrowParts.find((p) => p.type === 'year')?.value;
  const tomorrowDateStr = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

  // Sum PV forecast for tomorrow (W * 0.5h = Wh per slot, convert to kWh)
  let totalKwh = 0;
  for (const slot of pvForecast) {
    const slotDate = slot.valid_from.slice(0, 10);
    if (slotDate === tomorrowDateStr) {
      totalKwh += (slot.pv_estimate_w * HALF_HOUR_HOURS) / 1000;
    }
  }

  return totalKwh >= threshold;
}

// --- Pre-cheapest charge suppression ---

export function findSuppressedPreCheapestKeys(
  baseChargeWindows: ChargeWindow[],
  rates: AgileRate[],
  settings: AppSettings,
): Set<string> {
  if (settings.pre_cheapest_suppression !== 'true') return new Set();

  const slotsForFullCharge = calculateSlotsNeeded(0, 100, settings);
  if (slotsForFullCharge <= 0) return new Set();

  // Find the earliest charge slot across all base windows
  const allChargeKeys = new Set<string>();
  let earliestChargeStart: string | null = null;
  for (const w of baseChargeWindows) {
    for (const slot of w.slots) {
      allChargeKeys.add(slot.valid_from);
      if (!earliestChargeStart || slot.valid_from < earliestChargeStart) {
        earliestChargeStart = slot.valid_from;
      }
    }
  }

  if (!earliestChargeStart) return new Set();

  // Walk backward through sorted rates to find the slots before the cheapest block
  const sorted = [...rates].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const earliestIndex = sorted.findIndex((r) => r.valid_from === earliestChargeStart);
  if (earliestIndex <= 0) return new Set();

  const suppressed = new Set<string>();
  const lookback = Math.min(earliestIndex, slotsForFullCharge);
  for (let i = earliestIndex - lookback; i < earliestIndex; i++) {
    // Don't suppress slots that are themselves base charge slots
    if (!allChargeKeys.has(sorted[i].valid_from)) {
      suppressed.add(sorted[i].valid_from);
    }
  }

  return suppressed;
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
  const strategy = getChargingStrategy(settings);
  const skipOvernight = strategy === 'night_fill' &&
    shouldSkipOvernightCharge(context.pvForecast, settings, now);
  const rawBaseWindows = skipOvernight ? [] : findCheapestSlots(rates, settings, context);
  const rawNegativeWindows = findNegativePriceSlots(rates, settings);
  const alwaysCheapWindows = findAlwaysCheapSlots(rates, settings);

  // Long negative runs: leading slots are discharge windows. Remove them from
  // every charge-source window before composition — otherwise deduplicateAndMerge
  // drops the discharge classification (charge wins on conflict) and
  // buildSmartDischargePlan's simulatePlan treats the slot as charge in the SOC
  // forecast and marginal-cost gate.
  const negativeRunDischargeWindows = findNegativeRunDischargeSlots(rates, settings);
  const negativeRunDischargeKeys = flattenWindowSlotKeys(negativeRunDischargeWindows);

  const baseWindows = filterSuppressedWindows(rawBaseWindows, negativeRunDischargeKeys);
  const negativeWindows = filterSuppressedWindows(rawNegativeWindows, negativeRunDischargeKeys);

  // Pre-discharge intentionally uses the unfiltered negative windows so a long
  // run can still trigger a pre-slot discharge when the feature is enabled
  // independently. findPreDischargeSlots already refuses to emit a discharge when
  // the preceding slot is itself negative, so there's no risk of double-discharging.
  const preDischargeWindows = findPreDischargeSlots(rates, rawNegativeWindows, settings);

  const suppressedKeys = findSuppressedPreCheapestKeys(baseWindows, rates, settings);
  const peakPrepWindows = filterSuppressedWindows(
    filterSuppressedWindows(
      findPeakPrepSlots(rates, settings, context),
      suppressedKeys,
    ),
    negativeRunDischargeKeys,
  );
  const smartDischargePlan = buildSmartDischargePlan(
    rates,
    settings,
    [...baseWindows, ...negativeWindows, ...alwaysCheapWindows, ...peakPrepWindows],
    [...preDischargeWindows, ...negativeRunDischargeWindows],
    context,
    context.exportRates,
    context.pvForecast,
  );

  const windows = deduplicateAndMerge([
    ...baseWindows,
    ...negativeWindows,
    ...alwaysCheapWindows,
    ...smartDischargePlan.extraChargeWindows,
    ...peakPrepWindows,
  ], [
    ...preDischargeWindows,
    ...negativeRunDischargeWindows,
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
        alwaysCheapCharge: flattenWindowSlotKeys(alwaysCheapWindows),
        peakCharge: flattenWindowSlotKeys(peakPrepWindows),
        extraCharge: flattenWindowSlotKeys(smartDischargePlan.extraChargeWindows),
        preDischarge: flattenWindowSlotKeys(preDischargeWindows),
        negativeRunDischarge: flattenWindowSlotKeys(negativeRunDischargeWindows),
        smartDischarge: flattenWindowSlotKeys(smartDischargePlan.dischargeWindows),
      },
      exportRates: context.exportRates,
      pvForecast: context.pvForecast,
    }),
    _dischargeDebug: smartDischargePlan._debug,
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
    exportRates,
    pvForecast,
    pvConfidence,
  }: {
    now: Date;
    currentSoc: number | null;
    settings: AppSettings;
    sourceKeys: {
      negativeCharge: Set<string>;
      alwaysCheapCharge: Set<string>;
      peakCharge: Set<string>;
      extraCharge: Set<string>;
      preDischarge: Set<string>;
      negativeRunDischarge: Set<string>;
      smartDischarge: Set<string>;
    };
    exportRates?: AgileRate[];
    pvForecast?: PVForecastSlot[];
    pvConfidence?: string;
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
    if (actions[index] === 'do_nothing' && holdIndices.has(index)) {
      actions[index] = 'hold';
    }
  }

  const slotActions = new Map<number, PlanAction>();
  actions.forEach((action, index) => {
    if (action !== 'do_nothing') {
      slotActions.set(index, action);
    }
  });

  // Build PV generation map aligned to rate slot indices
  let perSlotPVGenerationW: Map<number, number> | undefined;
  if (pvForecast && pvForecast.length > 0) {
    const pvMap = new Map<string, number>();
    const confidence = pvConfidence || 'estimate';
    for (const pv of pvForecast) {
      const value = confidence === 'estimate10' ? pv.pv_estimate10_w
        : confidence === 'estimate90' ? pv.pv_estimate90_w
        : pv.pv_estimate_w;
      pvMap.set(pv.valid_from, value);
    }
    perSlotPVGenerationW = new Map<number, number>();
    futureRates.forEach((rate, index) => {
      const pvW = pvMap.get(rate.valid_from);
      if (pvW !== undefined && pvW > 0) {
        perSlotPVGenerationW!.set(index, pvW);
      }
    });
  }

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
          perSlotPVGenerationW,
        }).map((value) => Math.round(value * 10) / 10);

  const perSlotEnergyKwh = ((parseFloat(settings.max_charge_power_kw) || 3.6) * ((parseFloat(settings.charge_rate) || 100) / 100)) * HALF_HOUR_HOURS;

  // Build export rate lookup for discharge value calculation
  const exportRateMap = new Map<string, number>();
  if (exportRates) {
    for (const er of exportRates) {
      exportRateMap.set(er.valid_from, er.price_inc_vat);
    }
  }

  return futureRates.map((rate, index) => {
    const action = actions[index];
    let expectedValue: number | null = null;

    if (action === 'charge') {
      expectedValue = Math.round(-perSlotEnergyKwh * rate.price_inc_vat * 100) / 100;
    } else if (action === 'discharge') {
      // Use export rate if available, otherwise fall back to import rate
      // (which models avoided import cost for users without export payment)
      const dischargePrice = exportRateMap.get(rate.valid_from) ?? rate.price_inc_vat;
      expectedValue = Math.round(perSlotEnergyKwh * dischargePrice * 100) / 100;
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
    alwaysCheapCharge: Set<string>;
    peakCharge: Set<string>;
    extraCharge: Set<string>;
    preDischarge: Set<string>;
    negativeRunDischarge: Set<string>;
    smartDischarge: Set<string>;
  },
  strategicHoldKeys: Set<string>,
): string {
  if (action === 'charge') {
    if (sourceKeys.negativeCharge.has(slotStart)) {
      return 'Negative-price charge slot.';
    }
    if (sourceKeys.alwaysCheapCharge.has(slotStart)) {
      return 'Slot price below always-charge threshold.';
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
    if (sourceKeys.negativeRunDischarge.has(slotStart)) {
      return 'Discharge during extended negative-price run (recharging in later negative slots).';
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
