import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';
import { toSlotKey } from '../slot-key';
import { calculateSlotsNeeded, ChargeWindow, mergeAdjacentSlots, PlanningContext } from './engine';

const HALF_HOUR_HOURS = 0.5;
const SLOT_MS = 30 * 60 * 1000;

function clampPercentage(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

export function findNegativePriceSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_price_charging !== 'true') return [];

  const negativeSlots = rates.filter((r) => r.price_inc_vat < 0);
  if (negativeSlots.length === 0) return [];

  negativeSlots.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(negativeSlots);
}

export function findAlwaysCheapSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  const threshold = parseFloat(settings.always_charge_below_price) || 0;
  if (threshold <= 0) return [];

  // Slots that are positive but below the threshold (negatives are handled separately)
  const cheapSlots = rates.filter((r) => r.price_inc_vat > 0 && r.price_inc_vat < threshold);
  if (cheapSlots.length === 0) return [];

  cheapSlots.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(cheapSlots);
}

export function findPreDischargeSlots(
  rates: AgileRate[],
  negativeWindows: ChargeWindow[],
  settings: AppSettings,
  context: PlanningContext = {},
): ChargeWindow[] {
  if (settings.negative_price_pre_discharge !== 'true') return [];
  if (negativeWindows.length === 0) return [];

  const rateMap = new Map(rates.map((r) => [toSlotKey(r.valid_from), r]));
  const claimedKeys = new Set<string>();
  const dischargeSlots: AgileRate[] = [];

  // Energy per pre-discharge slot (load drained while serving the house) and
  // per negative slot (refill capacity once we recharge from the trough).
  const drainPerSlotKwh =
    ((parseFloat(settings.estimated_consumption_w) || 500) / 1000) * HALF_HOUR_HOURS;
  const chargeRatePct = parseFloat(settings.charge_rate);
  const effectiveChargeRate =
    (Number.isFinite(chargeRatePct) ? chargeRatePct : 100) / 100;
  const chargePerSlotKwh =
    (parseFloat(settings.max_charge_power_kw) || 3.6) * effectiveChargeRate * HALF_HOUR_HOURS;

  // Optional SOC safety: if we know current SoC, cap drain so we never go
  // below the discharge floor. The cap only binds for the *first* negative
  // window in the horizon — subsequent windows are assumed to refill the
  // battery (the negative run is what makes pre-discharge worth it in the
  // first place; the same assumption is made elsewhere in the planner).
  const currentSoc = context.currentSoc ?? null;
  const dischargeFloor =
    clampPercentage(parseFloat(settings.discharge_soc_floor)) ?? 0;
  const batteryCapacityKwh = parseFloat(settings.battery_capacity_kwh) || 0;
  let initialSocSlotCap = Number.POSITIVE_INFINITY;
  if (currentSoc !== null && batteryCapacityKwh > 0 && drainPerSlotKwh > 0) {
    const headroomPct = Math.max(0, currentSoc - dischargeFloor);
    const headroomKwh = (headroomPct / 100) * batteryCapacityKwh;
    initialSocSlotCap = Math.floor(headroomKwh / drainPerSlotKwh);
  }
  let firstWindowProcessed = false;

  for (const window of negativeWindows) {
    // Per-window refill capacity: how many pre-discharge half-hours can the
    // negative window energetically offset? One 30-min charge slot at 3.6 kW
    // (1.8 kWh) refills ~7 slots of typical 500 W load — usually generous.
    const refillCapacityKwh = window.slots.length * chargePerSlotKwh;
    const refillSlotCap =
      drainPerSlotKwh > 0 ? Math.floor(refillCapacityKwh / drainPerSlotKwh) : 0;

    const socSlotCap = firstWindowProcessed
      ? Number.POSITIVE_INFINITY
      : initialSocSlotCap;
    const slotCap = Math.min(refillSlotCap, socSlotCap);

    let slotsTaken = 0;
    let cursorMs = new Date(window.slot_start).getTime();
    while (slotsTaken < slotCap) {
      cursorMs -= SLOT_MS;
      const preRate = rateMap.get(toSlotKey(new Date(cursorMs)));
      if (!preRate) break;
      // Walked into another negative run — stop. The earlier negative
      // window will be handled by its own iteration.
      if (preRate.price_inc_vat < 0) break;
      // Already claimed by an earlier window's walk-back; stop here so we
      // don't sandwich a charge window between two pre-discharge runs.
      if (claimedKeys.has(preRate.valid_from)) break;

      claimedKeys.add(preRate.valid_from);
      dischargeSlots.push(preRate);
      slotsTaken += 1;
    }

    firstWindowProcessed = true;
  }

  if (dischargeSlots.length === 0) return [];

  dischargeSlots.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(dischargeSlots, 'discharge');
}

export function findNegativeRunDischargeSlots(
  rates: AgileRate[],
  settings: AppSettings,
): ChargeWindow[] {
  if (settings.negative_run_discharge !== 'true') return [];
  if (settings.negative_price_charging !== 'true') return [];

  const slotsForFullCharge = calculateSlotsNeeded(0, 100, settings);
  if (slotsForFullCharge <= 0) return [];

  const negativeSlots = rates
    .filter((r) => r.price_inc_vat < 0)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  if (negativeSlots.length === 0) return [];

  // Group into contiguous runs
  const runs: AgileRate[][] = [];
  let currentRun: AgileRate[] = [negativeSlots[0]];

  for (let i = 1; i < negativeSlots.length; i++) {
    const prev = currentRun[currentRun.length - 1];
    if (prev.valid_to === negativeSlots[i].valid_from) {
      currentRun.push(negativeSlots[i]);
    } else {
      runs.push(currentRun);
      currentRun = [negativeSlots[i]];
    }
  }
  runs.push(currentRun);

  // For runs longer than slotsForFullCharge, discharge the leading slots
  const dischargeSlots: AgileRate[] = [];
  for (const run of runs) {
    if (run.length > slotsForFullCharge) {
      // Leading (run.length - slotsForFullCharge) slots are discharge.
      // Trailing slotsForFullCharge slots remain charge candidates, but the
      // caller (buildSchedulePlan in engine.ts) is responsible for removing
      // the leading slots from findNegativePriceSlots' output before
      // composition — this function does NOT rewrite the charge windows.
      const dischargeCount = run.length - slotsForFullCharge;
      for (let i = 0; i < dischargeCount; i++) {
        dischargeSlots.push(run[i]);
      }
    }
  }

  if (dischargeSlots.length === 0) return [];
  return mergeAdjacentSlots(dischargeSlots, 'discharge');
}
