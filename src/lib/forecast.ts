export interface RateSlot {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

export interface ScheduleWindow {
  slot_start: string;
  slot_end: string;
}

export interface WindowCostEstimate {
  slot_start: string;
  slot_end: string;
  energy_kwh: number;
  cost_pence: number;
}

export interface CostForecast {
  total_energy_kwh: number;
  total_cost_pence: number;
  windows: WindowCostEstimate[];
}

export function calculateCostForecast(
  schedules: ScheduleWindow[],
  rates: RateSlot[],
  currentSoc: number,
  targetSoc: number,
  batteryCapacityKwh: number,
  maxChargePowerKw: number,
): CostForecast {
  const empty: CostForecast = { total_energy_kwh: 0, total_cost_pence: 0, windows: [] };

  if (currentSoc >= targetSoc || batteryCapacityKwh <= 0 || maxChargePowerKw <= 0) {
    return { ...empty, windows: schedules.map((s) => ({ slot_start: s.slot_start, slot_end: s.slot_end, energy_kwh: 0, cost_pence: 0 })) };
  }

  let remainingEnergy = batteryCapacityKwh * (targetSoc - currentSoc) / 100;
  const energyPerSlot = maxChargePowerKw * 0.5; // kWh per 30-min slot

  // Build rate lookup by epoch ms
  const rateLookup = new Map<number, number>();
  for (const r of rates) {
    rateLookup.set(new Date(r.valid_from).getTime(), r.price_inc_vat);
  }

  // Sort schedules chronologically
  const sorted = [...schedules].sort(
    (a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime(),
  );

  const windows: WindowCostEstimate[] = [];

  for (const sched of sorted) {
    let windowEnergy = 0;
    let windowCost = 0;
    let cursor = new Date(sched.slot_start).getTime();
    const end = new Date(sched.slot_end).getTime();

    while (cursor < end && remainingEnergy > 0) {
      const price = rateLookup.get(cursor);
      if (price !== undefined) {
        const delivered = Math.min(energyPerSlot, remainingEnergy);
        windowEnergy += delivered;
        windowCost += delivered * price;
        remainingEnergy -= delivered;
      }
      cursor += 30 * 60 * 1000;
    }

    windows.push({
      slot_start: sched.slot_start,
      slot_end: sched.slot_end,
      energy_kwh: Math.round(windowEnergy * 100) / 100,
      cost_pence: Math.round(windowCost * 100) / 100,
    });
  }

  return {
    total_energy_kwh: windows.reduce((sum, w) => sum + w.energy_kwh, 0),
    total_cost_pence: windows.reduce((sum, w) => sum + w.cost_pence, 0),
    windows,
  };
}

export function formatCost(pence: number): string {
  if (Math.abs(pence) < 100) {
    return `${Math.round(pence)}p`;
  }
  const pounds = pence / 100;
  return `£${pounds.toFixed(2)}`;
}
