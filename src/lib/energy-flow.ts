import type { InverterState } from '@/lib/types';

export type EnergyFlowPathKey =
  | 'solar_home'
  | 'solar_battery'
  | 'grid_home'
  | 'grid_battery'
  | 'battery_home'
  | 'home_grid';

export interface EnergyFlowSegment {
  pathKey: EnergyFlowPathKey;
  power: number;
}

const FLOW_ORDER: EnergyFlowPathKey[] = [
  'solar_home',
  'solar_battery',
  'grid_battery',
  'grid_home',
  'battery_home',
  'home_grid',
];

function positive(value: number): number {
  return value > 0 ? value : 0;
}

function takePower(available: number, requested: number) {
  const amount = Math.min(available, requested);
  return {
    amount,
    remainingAvailable: available - amount,
    remainingRequested: requested - amount,
  };
}

export function buildEnergyFlows(
  state: Pick<InverterState, 'pv_power' | 'grid_power' | 'battery_power' | 'load_power'>,
): EnergyFlowSegment[] {
  let solarSupply = positive(state.pv_power ?? 0);
  let gridSupply = positive(state.grid_power ?? 0);
  let batterySupply = positive(-(state.battery_power ?? 0));
  let homeDemand = positive(state.load_power ?? 0);
  let batteryDemand = positive(state.battery_power ?? 0);
  const exportDemand = positive(-(state.grid_power ?? 0));

  const totals = new Map<EnergyFlowPathKey, number>();
  const addFlow = (pathKey: EnergyFlowPathKey, power: number) => {
    if (power <= 0) return;
    totals.set(pathKey, (totals.get(pathKey) ?? 0) + power);
  };

  let allocation = takePower(solarSupply, homeDemand);
  addFlow('solar_home', allocation.amount);
  solarSupply = allocation.remainingAvailable;
  homeDemand = allocation.remainingRequested;

  allocation = takePower(solarSupply, batteryDemand);
  addFlow('solar_battery', allocation.amount);
  solarSupply = allocation.remainingAvailable;
  batteryDemand = allocation.remainingRequested;

  allocation = takePower(batterySupply, homeDemand);
  addFlow('battery_home', allocation.amount);
  batterySupply = allocation.remainingAvailable;
  homeDemand = allocation.remainingRequested;

  allocation = takePower(gridSupply, homeDemand);
  addFlow('grid_home', allocation.amount);
  gridSupply = allocation.remainingAvailable;
  homeDemand = allocation.remainingRequested;

  allocation = takePower(gridSupply, batteryDemand);
  addFlow('grid_battery', allocation.amount);
  gridSupply = allocation.remainingAvailable;
  batteryDemand = allocation.remainingRequested;

  // Fall back to the reported import/export direction when telemetry arrives slightly out of balance.
  if (batteryDemand > 0) {
    addFlow(state.grid_power !== null && state.grid_power > 0 ? 'grid_battery' : 'solar_battery', batteryDemand);
  }

  if (homeDemand > 0) {
    if (state.grid_power !== null && state.grid_power > 0) {
      addFlow('grid_home', homeDemand);
    } else if (state.battery_power !== null && state.battery_power < 0) {
      addFlow('battery_home', homeDemand);
    } else {
      addFlow('solar_home', homeDemand);
    }
  }

  addFlow('home_grid', exportDemand);

  return FLOW_ORDER.flatMap((pathKey) => {
    const power = totals.get(pathKey) ?? 0;
    return power > 0 ? [{ pathKey, power }] : [];
  });
}
