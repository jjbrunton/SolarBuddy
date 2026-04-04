import type { InverterState } from '@/lib/types';
import type { AgileRate } from '@/lib/octopus/rates';
import type { PVForecastSlot } from '@/lib/scheduler/engine';

export interface VirtualScenarioSlot {
  valid_from: string;
  valid_to: string;
  pv_power: number;
  load_power: number;
  connected: boolean;
  import_rate: number;
  export_rate: number;
  device_mode?: string;
}

export interface VirtualScenarioData {
  id: string;
  name: string;
  description: string;
  purpose: string;
  initialState: Partial<InverterState>;
  slots: VirtualScenarioSlot[];
  rates: AgileRate[];
  exportRates: AgileRate[];
  pvForecast: PVForecastSlot[];
}

export interface VirtualScenarioDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  defaultStartSoc: number;
  build(params: {
    startTime: Date;
    startSoc: number;
    loadMultiplier: number;
  }): VirtualScenarioData;
}

export interface VirtualScenarioSummary {
  id: string;
  name: string;
  description: string;
  purpose: string;
  defaultStartSoc: number;
}

function alignToHalfHour(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  next.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
  return next;
}

function slotTimes(startTime: Date, count: number) {
  const start = alignToHalfHour(startTime);
  return Array.from({ length: count }, (_, index) => {
    const validFrom = new Date(start.getTime() + index * 30 * 60 * 1000);
    const validTo = new Date(validFrom.getTime() + 30 * 60 * 1000);
    return { validFrom, validTo };
  });
}

function createData(
  definition: Omit<VirtualScenarioData, 'rates' | 'exportRates' | 'pvForecast'>
): VirtualScenarioData {
  return {
    ...definition,
    rates: definition.slots.map((slot) => ({
      valid_from: slot.valid_from,
      valid_to: slot.valid_to,
      price_inc_vat: slot.import_rate,
      price_exc_vat: slot.import_rate,
    })),
    exportRates: definition.slots.map((slot) => ({
      valid_from: slot.valid_from,
      valid_to: slot.valid_to,
      price_inc_vat: slot.export_rate,
      price_exc_vat: slot.export_rate,
    })),
    pvForecast: definition.slots.map((slot) => ({
      valid_from: slot.valid_from,
      valid_to: slot.valid_to,
      pv_estimate_w: slot.pv_power,
      pv_estimate10_w: Math.max(0, Math.round(slot.pv_power * 0.8)),
      pv_estimate90_w: Math.round(slot.pv_power * 1.15),
    })),
  };
}

function overnightRecovery({
  startTime,
  startSoc,
  loadMultiplier,
}: {
  startTime: Date;
  startSoc: number;
  loadMultiplier: number;
}): VirtualScenarioData {
  const slots = slotTimes(startTime, 48).map(({ validFrom, validTo }, index) => {
    const hour = validFrom.getHours();
    const isCheap = hour >= 0 && hour < 5;
    const isMorningSolar = hour >= 9 && hour < 16;
    const pv = isMorningSolar ? Math.max(0, (1 - Math.abs(12.5 - hour) / 4) * 2800) : 0;
    const load = (hour >= 17 && hour < 22 ? 1200 : 600) * loadMultiplier;

    return {
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
      pv_power: Math.round(pv),
      load_power: Math.round(load),
      connected: true,
      import_rate: isCheap ? 7.8 : hour >= 17 && hour < 21 ? 31.5 : 18.2 + (index % 3),
      export_rate: 11.2,
      device_mode: 'Line',
    };
  });

  return createData({
    id: 'overnight-recovery',
    name: 'Low Battery Overnight Recovery',
    description: 'Cheap overnight slots and a weak starting battery to exercise recovery planning.',
    purpose: 'Test Night Fill planning and the transition into a healthier morning SOC.',
    initialState: {
      battery_soc: startSoc,
      work_mode: 'Battery first',
      device_mode: 'Line',
      battery_temperature: 24,
      inverter_temperature: 28,
      grid_voltage: 232,
      grid_frequency: 50,
    },
    slots,
  });
}

function sunnySurplus({
  startTime,
  startSoc,
  loadMultiplier,
}: {
  startTime: Date;
  startSoc: number;
  loadMultiplier: number;
}): VirtualScenarioData {
  const slots = slotTimes(startTime, 48).map(({ validFrom, validTo }) => {
    const hour = validFrom.getHours() + validFrom.getMinutes() / 60;
    const solarShape = Math.max(0, 1 - Math.abs(13 - hour) / 4.5);
    const pv = Math.round(solarShape * 4300);
    const load = Math.round((hour >= 18 && hour < 22 ? 1000 : 450) * loadMultiplier);
    return {
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
      pv_power: pv,
      load_power: load,
      connected: true,
      import_rate: hour >= 11 && hour < 15 ? 9.8 : hour >= 17 && hour < 21 ? 25.6 : 16.4,
      export_rate: 15.5,
      device_mode: 'Battery',
    };
  });

  return createData({
    id: 'sunny-surplus',
    name: 'Sunny Surplus Day',
    description: 'Strong midday PV generation with export opportunity and modest daytime load.',
    purpose: 'Test solar-led charging, hold behavior, and export-aware discharge decisions.',
    initialState: {
      battery_soc: startSoc,
      work_mode: 'Battery first',
      device_mode: 'Battery',
      battery_temperature: 27,
      inverter_temperature: 31,
      grid_voltage: 231,
      grid_frequency: 50,
    },
    slots,
  });
}

function eveningPeak({
  startTime,
  startSoc,
  loadMultiplier,
}: {
  startTime: Date;
  startSoc: number;
  loadMultiplier: number;
}): VirtualScenarioData {
  const slots = slotTimes(startTime, 48).map(({ validFrom, validTo }) => {
    const hour = validFrom.getHours() + validFrom.getMinutes() / 60;
    const pv = hour >= 10 && hour < 15 ? Math.round((1 - Math.abs(12.5 - hour) / 3) * 1800) : 0;
    const load = Math.round((hour >= 17 && hour < 22 ? 1800 : 700) * loadMultiplier);
    return {
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
      pv_power: Math.max(0, pv),
      load_power: load,
      connected: true,
      import_rate: hour >= 17 && hour < 21 ? 38.5 : hour >= 0 && hour < 5 ? 8.2 : 19.1,
      export_rate: 12.8,
      device_mode: 'Battery',
    };
  });

  return createData({
    id: 'evening-peak',
    name: 'Evening Peak Arbitrage',
    description: 'A pronounced evening price spike with enough stored energy to test profitable discharge.',
    purpose: 'Test smart discharge decisions and peak-period battery preservation.',
    initialState: {
      battery_soc: startSoc,
      work_mode: 'Battery first',
      device_mode: 'Battery',
      battery_temperature: 26,
      inverter_temperature: 30,
      grid_voltage: 233,
      grid_frequency: 50,
    },
    slots,
  });
}

function mqttOffline({
  startTime,
  startSoc,
  loadMultiplier,
}: {
  startTime: Date;
  startSoc: number;
  loadMultiplier: number;
}): VirtualScenarioData {
  const slots = slotTimes(startTime, 48).map(({ validFrom, validTo }, index) => {
    const hour = validFrom.getHours() + validFrom.getMinutes() / 60;
    const connected = index < 4 || index > 8;
    const pv = connected && hour >= 10 && hour < 16 ? Math.round((1 - Math.abs(13 - hour) / 4) * 2200) : 0;
    const load = Math.round((hour >= 18 && hour < 22 ? 1200 : 650) * loadMultiplier);
    return {
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
      pv_power: Math.max(0, pv),
      load_power: load,
      connected,
      import_rate: connected ? (hour >= 0 && hour < 5 ? 9.4 : 21.7) : 0,
      export_rate: connected ? 10.5 : 0,
      device_mode: connected ? 'Line' : 'Fault',
    };
  });

  return createData({
    id: 'offline-recovery',
    name: 'Inverter Offline Recovery',
    description: 'A temporary telemetry outage followed by recovery so the UI and watchdog can be exercised safely.',
    purpose: 'Test offline states, recovery messaging, and safe resumption of virtual control.',
    initialState: {
      battery_soc: startSoc,
      work_mode: 'Battery first',
      device_mode: 'Line',
      battery_temperature: 25,
      inverter_temperature: 29,
      grid_voltage: 230,
      grid_frequency: 50,
    },
    slots,
  });
}

const SCENARIOS: VirtualScenarioDefinition[] = [
  {
    id: 'overnight-recovery',
    name: 'Low Battery Overnight Recovery',
    description: 'Cheap overnight slots and a weak starting battery to exercise recovery planning.',
    purpose: 'Test Night Fill planning and recovery from a low starting SOC.',
    defaultStartSoc: 18,
    build: overnightRecovery,
  },
  {
    id: 'sunny-surplus',
    name: 'Sunny Surplus Day',
    description: 'Strong midday PV generation with export opportunity and modest daytime load.',
    purpose: 'Test solar-led charging and surplus handling.',
    defaultStartSoc: 52,
    build: sunnySurplus,
  },
  {
    id: 'evening-peak',
    name: 'Evening Peak Arbitrage',
    description: 'A pronounced evening price spike with enough stored energy to test profitable discharge.',
    purpose: 'Test discharge-led plans during peak pricing.',
    defaultStartSoc: 76,
    build: eveningPeak,
  },
  {
    id: 'offline-recovery',
    name: 'Inverter Offline Recovery',
    description: 'A temporary telemetry outage followed by recovery so the UI and watchdog can be exercised safely.',
    purpose: 'Test connection loss and recovery messaging.',
    defaultStartSoc: 61,
    build: mqttOffline,
  },
];

export function listVirtualScenarios(): VirtualScenarioSummary[] {
  return SCENARIOS.map(({ id, name, description, purpose, defaultStartSoc }) => ({
    id,
    name,
    description,
    purpose,
    defaultStartSoc,
  }));
}

export function getVirtualScenario(id: string): VirtualScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
