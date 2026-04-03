import type { AgileRate } from './octopus/rates';
import type { AppSettings } from './config';
import { buildSchedulePlan, type PlanningContext, type PVForecastSlot, type PlannedSlot, type SchedulePlan } from './scheduler/engine';

export interface SimulatedSlot {
  slot_start: string;
  slot_end: string;
  action: string;
  reason: string;
  soc_before: number;
  soc_after: number;
  import_kwh: number;
  export_kwh: number;
  cost_pence: number;
  revenue_pence: number;
  pv_generation_kwh: number;
  import_rate: number;
  export_rate: number;
}

export interface SimulationSummary {
  total_import_cost: number;
  total_export_revenue: number;
  net_cost: number;
  max_soc: number;
  min_soc: number;
  charge_slot_count: number;
  discharge_slot_count: number;
  hold_slot_count: number;
  total_pv_kwh: number;
}

export interface SimulationResult {
  plan: SchedulePlan;
  slots: SimulatedSlot[];
  summary: SimulationSummary;
}

/**
 * Run a full simulation: plan + energy simulation using the real planner.
 * No commands are sent — this is purely hypothetical.
 */
export function runFullSimulation(params: {
  rates: AgileRate[];
  settings: AppSettings;
  startSoc: number;
  exportRates?: AgileRate[];
  pvForecast?: PVForecastSlot[];
  now?: Date;
}): SimulationResult {
  const { rates, settings, startSoc, exportRates, pvForecast, now } = params;

  const context: PlanningContext = {
    currentSoc: startSoc,
    now: now ?? new Date(),
    exportRates,
    pvForecast,
  };

  const plan = buildSchedulePlan(rates, settings, context);

  // Build lookup maps
  const exportRateMap = new Map<string, number>();
  if (exportRates) {
    for (const er of exportRates) {
      exportRateMap.set(er.valid_from, er.price_inc_vat);
    }
  }

  const pvMap = new Map<string, number>();
  if (pvForecast) {
    for (const pv of pvForecast) {
      pvMap.set(pv.valid_from, pv.pv_estimate_w);
    }
  }

  const slotActionMap = new Map<string, PlannedSlot>();
  for (const slot of plan.slots) {
    slotActionMap.set(slot.slot_start, slot);
  }

  // Energy model
  const batteryCapacityWh = (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000;
  const maxChargePowerW = (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000;
  const chargeRate = parseFloat(settings.charge_rate) || 100;
  const effectiveChargePowerW = maxChargePowerW * (chargeRate / 100);
  const consumptionW = parseFloat(settings.estimated_consumption_w) || 500;

  const chargePerSlotWh = effectiveChargePowerW * 0.5;
  const drainPerSlotWh = consumptionW * 0.5;

  let soc = startSoc;
  let maxSoc = soc;
  let minSoc = soc;
  let totalImportCost = 0;
  let totalExportRevenue = 0;
  let totalPvKwh = 0;
  let chargeCount = 0;
  let dischargeCount = 0;
  let holdCount = 0;

  const simSlots: SimulatedSlot[] = [];

  for (const rate of rates) {
    const planned = slotActionMap.get(rate.valid_from);
    const action = planned?.action ?? 'hold';
    const reason = planned?.reason ?? 'No plan for this slot.';
    const pvW = pvMap.get(rate.valid_from) ?? 0;
    const pvWh = pvW * 0.5;
    const pvKwh = pvWh / 1000;
    totalPvKwh += pvKwh;

    const socBefore = soc;
    let importKwh = 0;
    let exportKwh = 0;

    switch (action) {
      case 'charge': {
        const addWh = chargePerSlotWh + Math.max(0, pvWh - drainPerSlotWh);
        soc = Math.min(100, soc + (addWh / batteryCapacityWh) * 100);
        importKwh = chargePerSlotWh / 1000;
        chargeCount++;
        break;
      }
      case 'discharge': {
        const effectiveDischargeWh = Math.max(0, (chargePerSlotWh + drainPerSlotWh) - pvWh);
        soc = Math.max(0, soc - (effectiveDischargeWh / batteryCapacityWh) * 100);
        exportKwh = effectiveDischargeWh / 1000;
        dischargeCount++;
        break;
      }
      case 'hold': {
        if (pvWh > drainPerSlotWh) {
          const surplus = pvWh - drainPerSlotWh;
          soc = Math.min(100, soc + (surplus / batteryCapacityWh) * 100);
        }
        holdCount++;
        break;
      }
      default: {
        const netDrain = drainPerSlotWh - pvWh;
        if (netDrain > 0) {
          soc = Math.max(0, soc - (netDrain / batteryCapacityWh) * 100);
        } else {
          soc = Math.min(100, soc + (-netDrain / batteryCapacityWh) * 100);
        }
        holdCount++;
      }
    }

    maxSoc = Math.max(maxSoc, soc);
    minSoc = Math.min(minSoc, soc);

    const importRate = rate.price_inc_vat;
    const expRate = exportRateMap.get(rate.valid_from) ?? rate.price_inc_vat;
    const costPence = importKwh * importRate;
    const revenuePence = exportKwh * expRate;
    totalImportCost += costPence;
    totalExportRevenue += revenuePence;

    simSlots.push({
      slot_start: rate.valid_from,
      slot_end: rate.valid_to,
      action,
      reason,
      soc_before: round1(socBefore),
      soc_after: round1(soc),
      import_kwh: round3(importKwh),
      export_kwh: round3(exportKwh),
      cost_pence: round2(costPence),
      revenue_pence: round2(revenuePence),
      pv_generation_kwh: round3(pvKwh),
      import_rate: importRate,
      export_rate: expRate,
    });
  }

  return {
    plan,
    slots: simSlots,
    summary: {
      total_import_cost: round2(totalImportCost),
      total_export_revenue: round2(totalExportRevenue),
      net_cost: round2(totalImportCost - totalExportRevenue),
      max_soc: round1(maxSoc),
      min_soc: round1(minSoc),
      charge_slot_count: chargeCount,
      discharge_slot_count: dischargeCount,
      hold_slot_count: holdCount,
      total_pv_kwh: round2(totalPvKwh),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
