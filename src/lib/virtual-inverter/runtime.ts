import { appendEvent } from '@/lib/events';
import { appendMqttLog } from '@/lib/mqtt/logs';
import { getSettings } from '@/lib/config';
import { getState, replaceState, updateState } from '@/lib/state';
import { INITIAL_STATE, type InverterState } from '@/lib/types';
import { buildSchedulePlan, type PlannedSlot } from '@/lib/scheduler/engine';
import { type AgileRate } from '@/lib/octopus/rates';
import { listVirtualScenarios, getVirtualScenario, type VirtualScenarioData, type VirtualScenarioSummary } from './scenarios';

export type VirtualPlaybackState = 'stopped' | 'running' | 'paused';

export interface VirtualInverterStatus {
  enabled: boolean;
  scenarioId: string;
  scenarioName: string | null;
  playbackState: VirtualPlaybackState;
  speed: string;
  virtualTime: string | null;
  startSoc: number;
  loadMultiplier: number;
  availableControls: Array<'start' | 'pause' | 'reset' | 'disable'>;
}

interface VirtualCommandState {
  action: 'idle' | 'charge' | 'discharge' | 'hold';
  workMode: 'Grid first' | 'Battery first' | 'Load first';
  outputSourcePriority: string;
  batteryFirstChargeRate: number;
  loadFirstStopDischarge: number;
}

interface VirtualRuntimeStore {
  enabled: boolean;
  playbackState: VirtualPlaybackState;
  scenarioId: string;
  speed: string;
  virtualTime: string | null;
  timer: ReturnType<typeof setInterval> | null;
  startSoc: number;
  loadMultiplier: number;
  command: VirtualCommandState;
  scenarioData: VirtualScenarioData | null;
}

const DEFAULT_TICK_MS = 1000;
const SPEED_TO_MINUTES: Record<string, number> = {
  '1x': 1,
  '6x': 6,
  '30x': 30,
};

const g = globalThis as typeof globalThis & {
  __solarbuddy_virtual_inverter?: VirtualRuntimeStore;
};

function getStore(): VirtualRuntimeStore {
  if (!g.__solarbuddy_virtual_inverter) {
    g.__solarbuddy_virtual_inverter = {
      enabled: false,
      playbackState: 'stopped',
      scenarioId: 'overnight-recovery',
      speed: '6x',
      virtualTime: null,
      timer: null,
      startSoc: 50,
      loadMultiplier: 1,
      command: {
        action: 'idle',
        workMode: 'Battery first',
        outputSourcePriority: 'USB',
        batteryFirstChargeRate: 100,
        loadFirstStopDischarge: 20,
      },
      scenarioData: null,
    };
  }

  return g.__solarbuddy_virtual_inverter;
}

function getSpeedMinutes(speed: string) {
  return SPEED_TO_MINUTES[speed] ?? SPEED_TO_MINUTES['6x'];
}

function round(n: number, places = 1) {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function clampSoc(value: number) {
  return Math.max(0, Math.min(100, value));
}

function chooseScenarioData(
  scenarioId: string,
  startSoc: number,
  loadMultiplier: number
) {
  const scenario = getVirtualScenario(scenarioId);
  const data = scenario.build({
    startTime: new Date(),
    startSoc,
    loadMultiplier,
  });
  return { scenario, data };
}

function updateVirtualState(next: Partial<InverterState>) {
  updateState({
    runtime_mode: 'virtual',
    virtual_scenario_id: getStore().scenarioId,
    virtual_scenario_name: getStore().scenarioData?.name ?? null,
    virtual_playback_state: getStore().playbackState,
    virtual_time: getStore().virtualTime,
    ...next,
  });
}

function getScenarioSlot(isoTime: string | null) {
  const store = getStore();
  if (!store.scenarioData || !isoTime) {
    return null;
  }

  return (
    store.scenarioData.slots.find((slot) => slot.valid_from <= isoTime && slot.valid_to > isoTime) ??
    store.scenarioData.slots[store.scenarioData.slots.length - 1] ??
    null
  );
}

function buildSnapshotState(isoTime: string): Partial<InverterState> {
  const store = getStore();
  const settings = getSettings();
  const slot = getScenarioSlot(isoTime);

  if (!slot) {
    return {
      runtime_mode: 'virtual',
      virtual_scenario_id: store.scenarioId,
      virtual_scenario_name: store.scenarioData?.name ?? null,
      virtual_playback_state: store.playbackState,
      virtual_time: isoTime,
    };
  }

  if (!slot.connected) {
    return {
      runtime_mode: 'virtual',
      virtual_scenario_id: store.scenarioId,
      virtual_scenario_name: store.scenarioData?.name ?? null,
      virtual_playback_state: store.playbackState,
      virtual_time: isoTime,
      mqtt_connected: false,
      device_mode: slot.device_mode ?? 'Fault',
      pv_power: null,
      grid_power: null,
      load_power: null,
      battery_power: null,
    };
  }

  const currentState = getState();
  const currentSoc = currentState.battery_soc ?? store.startSoc;
  const dtHours = getSpeedMinutes(store.speed) / 60;
  const batteryCapacityWh = (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000;
  const maxChargePowerW = (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000;
  const chargeRatePct = parseFloat(settings.charge_rate) || store.command.batteryFirstChargeRate || 100;
  const effectiveChargePowerW = maxChargePowerW * (chargeRatePct / 100);
  const dischargeFloor = parseFloat(settings.discharge_soc_floor) || 20;

  const loadPower = slot.load_power;
  const pvPower = slot.pv_power;
  const powerToFull = ((100 - currentSoc) / 100) * batteryCapacityWh / Math.max(dtHours, 1 / 60);
  const powerToFloor = ((currentSoc - dischargeFloor) / 100) * batteryCapacityWh / Math.max(dtHours, 1 / 60);

  let batteryPower = 0;
  let gridPower = loadPower - pvPower;
  let nextSoc = currentSoc;

  if (store.command.action === 'charge') {
    batteryPower = Math.max(0, Math.min(effectiveChargePowerW, powerToFull));
    gridPower = loadPower - pvPower + batteryPower;
    nextSoc = clampSoc(currentSoc + (batteryPower * dtHours / batteryCapacityWh) * 100);
  } else if (store.command.action === 'discharge') {
    const dischargePower = Math.max(0, Math.min(effectiveChargePowerW, powerToFloor));
    batteryPower = -dischargePower;
    gridPower = loadPower - pvPower - dischargePower;
    nextSoc = clampSoc(currentSoc - (dischargePower * dtHours / batteryCapacityWh) * 100);
  } else {
    const solarSurplus = Math.max(0, pvPower - loadPower);
    const solarCharge = Math.max(0, Math.min(solarSurplus, effectiveChargePowerW, powerToFull));
    batteryPower = solarCharge;
    gridPower = loadPower - pvPower - solarCharge;
    nextSoc = clampSoc(currentSoc + (solarCharge * dtHours / batteryCapacityWh) * 100);
  }

  return {
    runtime_mode: 'virtual',
    virtual_scenario_id: store.scenarioId,
    virtual_scenario_name: store.scenarioData?.name ?? null,
    virtual_playback_state: store.playbackState,
    virtual_time: isoTime,
    mqtt_connected: true,
    battery_soc: round(nextSoc),
    pv_power: Math.round(pvPower),
    load_power: Math.round(loadPower),
    grid_power: Math.round(gridPower),
    battery_power: Math.round(batteryPower),
    work_mode: store.command.workMode,
    device_mode: slot.device_mode ?? 'Line',
    battery_voltage: round(50 + nextSoc * 0.05, 1),
    battery_temperature: currentState.battery_temperature ?? 25,
    inverter_temperature: currentState.inverter_temperature ?? 30,
    grid_voltage: currentState.grid_voltage ?? 230,
    grid_frequency: currentState.grid_frequency ?? 50,
    battery_first_charge_rate: store.command.batteryFirstChargeRate,
    battery_first_grid_charge: store.command.action === 'charge' ? 'Enabled' : 'Disabled',
    battery_first_stop_charge: 100,
    load_first_stop_discharge: store.command.loadFirstStopDischarge,
    output_source_priority: store.command.outputSourcePriority,
    max_charge_current: round((effectiveChargePowerW / Math.max(currentState.grid_voltage ?? 230, 1)), 1),
  };
}

function stopTimer() {
  const store = getStore();
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
}

function tick() {
  const store = getStore();
  if (!store.enabled || store.playbackState !== 'running' || !store.virtualTime) {
    return;
  }

  const nextTime = new Date(store.virtualTime);
  nextTime.setMinutes(nextTime.getMinutes() + getSpeedMinutes(store.speed));
  const lastSlotEnd = store.scenarioData?.slots[store.scenarioData.slots.length - 1]?.valid_to ?? null;

  if (lastSlotEnd && nextTime.toISOString() >= lastSlotEnd) {
    store.virtualTime = lastSlotEnd;
    store.playbackState = 'stopped';
    stopTimer();
    updateVirtualState(buildSnapshotState(store.virtualTime));
    appendEvent({
      level: 'info',
      category: 'virtual-inverter',
      message: 'Virtual inverter scenario reached the end of its scripted horizon.',
    });
    return;
  }

  store.virtualTime = nextTime.toISOString();
  updateVirtualState(buildSnapshotState(store.virtualTime));
}

function startTimer() {
  const store = getStore();
  stopTimer();
  store.timer = setInterval(tick, DEFAULT_TICK_MS);
}

function applyScenarioState() {
  const store = getStore();
  if (!store.scenarioData) {
    return;
  }

  const firstSlot = store.scenarioData.slots[0];
  if (!firstSlot) {
    return;
  }

  store.virtualTime = firstSlot.valid_from;
  store.command = {
    action: 'idle',
    workMode: (store.scenarioData.initialState.work_mode as VirtualCommandState['workMode']) ?? 'Battery first',
    outputSourcePriority: store.scenarioData.initialState.output_source_priority ?? 'USB',
    batteryFirstChargeRate: store.scenarioData.initialState.battery_first_charge_rate ?? 100,
    loadFirstStopDischarge: store.scenarioData.initialState.load_first_stop_discharge ?? 20,
  };

  replaceState({
    ...INITIAL_STATE,
    runtime_mode: 'virtual',
    virtual_scenario_id: store.scenarioId,
    virtual_scenario_name: store.scenarioData.name,
    virtual_playback_state: store.playbackState,
    virtual_time: store.virtualTime,
    ...store.scenarioData.initialState,
    mqtt_connected: true,
  });

  updateVirtualState(buildSnapshotState(store.virtualTime));
}

export function listAvailableVirtualScenarios(): VirtualScenarioSummary[] {
  return listVirtualScenarios();
}

export function isVirtualModeEnabled() {
  return getStore().enabled || getSettings().virtual_mode_enabled === 'true';
}

export function getVirtualNow() {
  const store = getStore();
  if (store.enabled && store.virtualTime) {
    return new Date(store.virtualTime);
  }

  return new Date();
}

export function getVirtualRates(from?: string, to?: string): AgileRate[] {
  const rates = getStore().scenarioData?.rates ?? [];
  return rates.filter((rate) => (!from || rate.valid_from >= from) && (!to || rate.valid_to <= to));
}

export function getVirtualExportRates(from?: string, to?: string): AgileRate[] {
  const rates = getStore().scenarioData?.exportRates ?? [];
  return rates.filter((rate) => (!from || rate.valid_from >= from) && (!to || rate.valid_to <= to));
}

export function getVirtualForecast(from?: string, to?: string) {
  const forecast = getStore().scenarioData?.pvForecast ?? [];
  return forecast.filter((slot) => (!from || slot.valid_from >= from) && (!to || slot.valid_to <= to));
}

function buildVirtualScheduleRows(now: Date) {
  const store = getStore();
  if (!store.scenarioData) {
    return { schedules: [], plan_slots: [] };
  }

  const settings = getSettings();
  const currentSoc = getState().battery_soc ?? store.startSoc;
  const plan = buildSchedulePlan(store.scenarioData.rates, settings, {
    currentSoc,
    now,
    exportRates: store.scenarioData.exportRates,
    pvForecast: store.scenarioData.pvForecast,
  });

  const createdAt = now.toISOString();
  return {
    schedules: plan.windows.map((window, index) => ({
      id: `virtual-schedule-${index}`,
      date: window.slot_start.split('T')[0],
      slot_start: window.slot_start,
      slot_end: window.slot_end,
      avg_price: window.avg_price,
      status: 'planned',
      created_at: createdAt,
      type: window.type ?? 'charge',
    })),
    plan_slots: plan.slots.map((slot, index) => ({
      id: `virtual-slot-${index}`,
      date: slot.slot_start.split('T')[0],
      slot_start: slot.slot_start,
      slot_end: slot.slot_end,
      action: slot.action,
      reason: slot.reason,
      expected_soc_after: slot.expected_soc_after,
      expected_value: slot.expected_value,
      status: 'planned',
      created_at: createdAt,
    })),
  };
}

export function getVirtualScheduleData(now = getVirtualNow()) {
  return buildVirtualScheduleRows(now);
}

export function getVirtualCurrentPlanSlot(nowIso: string): PlannedSlot | null {
  const { plan_slots } = getVirtualScheduleData(new Date(nowIso));
  return (
    (plan_slots.find((slot) => slot.slot_start <= nowIso && slot.slot_end > nowIso) as PlannedSlot | undefined) ??
    null
  );
}

export function getVirtualInverterStatus(): VirtualInverterStatus {
  const store = getStore();
  return {
    enabled: store.enabled,
    scenarioId: store.scenarioId,
    scenarioName: store.scenarioData?.name ?? null,
    playbackState: store.playbackState,
    speed: store.speed,
    virtualTime: store.virtualTime,
    startSoc: store.startSoc,
    loadMultiplier: store.loadMultiplier,
    availableControls: store.enabled ? ['start', 'pause', 'reset', 'disable'] : ['start'],
  };
}

export function enableVirtualInverter(options?: {
  scenarioId?: string;
  speed?: string;
  startSoc?: number;
  loadMultiplier?: number;
}) {
  const store = getStore();
  const scenarioId = options?.scenarioId ?? getSettings().virtual_scenario_id ?? store.scenarioId;
  const speed = options?.speed ?? getSettings().virtual_speed ?? store.speed;
  const scenario = getVirtualScenario(scenarioId);
  const startSoc = clampSoc(options?.startSoc ?? store.startSoc ?? scenario.defaultStartSoc);
  const loadMultiplier = options?.loadMultiplier ?? store.loadMultiplier ?? 1;
  const { data } = chooseScenarioData(scenarioId, startSoc, loadMultiplier);

  store.enabled = true;
  store.playbackState = 'stopped';
  store.scenarioId = scenarioId;
  store.speed = speed;
  store.startSoc = startSoc;
  store.loadMultiplier = loadMultiplier;
  store.scenarioData = data;
  applyScenarioState();

  appendEvent({
    level: 'info',
    category: 'virtual-inverter',
    message: `Virtual inverter enabled with scenario "${data.name}".`,
  });
}

export function disableVirtualInverter() {
  const store = getStore();
  stopTimer();
  store.enabled = false;
  store.playbackState = 'stopped';
  store.scenarioData = null;
  store.virtualTime = null;
  replaceState({
    ...INITIAL_STATE,
    runtime_mode: 'real',
    virtual_scenario_id: null,
    virtual_scenario_name: null,
    virtual_playback_state: null,
    virtual_time: null,
  });
  appendEvent({
    level: 'info',
    category: 'virtual-inverter',
    message: 'Virtual inverter disabled. SolarBuddy has returned to live-runtime mode.',
  });
}

export function startVirtualInverter() {
  const store = getStore();
  if (!store.enabled) {
    enableVirtualInverter();
  }
  store.playbackState = 'running';
  updateVirtualState({});
  startTimer();
}

export function pauseVirtualInverter() {
  const store = getStore();
  store.playbackState = 'paused';
  stopTimer();
  updateVirtualState({});
}

export function resetVirtualInverter(options?: { startSoc?: number; loadMultiplier?: number }) {
  const store = getStore();
  const scenario = getVirtualScenario(store.scenarioId);
  const startSoc = clampSoc(options?.startSoc ?? store.startSoc ?? scenario.defaultStartSoc);
  const loadMultiplier = options?.loadMultiplier ?? store.loadMultiplier ?? 1;
  const { data } = chooseScenarioData(store.scenarioId, startSoc, loadMultiplier);
  store.playbackState = 'stopped';
  store.startSoc = startSoc;
  store.loadMultiplier = loadMultiplier;
  store.scenarioData = data;
  stopTimer();
  applyScenarioState();
}

export async function syncVirtualInverterSetting() {
  const settings = getSettings();

  if (settings.virtual_mode_enabled === 'true') {
    const { disconnectMqtt } = await import('@/lib/mqtt/client');
    disconnectMqtt();
    enableVirtualInverter({
      scenarioId: settings.virtual_scenario_id,
      speed: settings.virtual_speed,
    });
    return;
  }

  if (getStore().enabled) {
    disableVirtualInverter();
    const { connectMqtt } = await import('@/lib/mqtt/client');
    connectMqtt();
  }
}

export function handleVirtualCommand(message: string, updates?: Partial<VirtualCommandState>) {
  const store = getStore();
  if (updates) {
    store.command = { ...store.command, ...updates };
  }

  appendEvent({
    level: 'info',
    category: 'virtual-inverter',
    message,
  });
  appendMqttLog({
    level: 'info',
    direction: 'outbound',
    topic: 'virtual-inverter',
    payload: message,
  });
  updateVirtualState(buildSnapshotState(store.virtualTime ?? new Date().toISOString()));
}

export function resetVirtualInverterForTests() {
  const store = getStore();
  stopTimer();
  store.enabled = false;
  store.playbackState = 'stopped';
  store.scenarioId = 'overnight-recovery';
  store.speed = '6x';
  store.virtualTime = null;
  store.startSoc = 50;
  store.loadMultiplier = 1;
  store.scenarioData = null;
  store.command = {
    action: 'idle',
    workMode: 'Battery first',
    outputSourcePriority: 'USB',
    batteryFirstChargeRate: 100,
    loadFirstStopDischarge: 20,
  };
  replaceState({
    ...INITIAL_STATE,
    runtime_mode: 'real',
    virtual_scenario_id: null,
    virtual_scenario_name: null,
    virtual_playback_state: null,
    virtual_time: null,
  });
}
