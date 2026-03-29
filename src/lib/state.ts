import { EventEmitter } from 'events';

export interface InverterState {
  battery_soc: number | null;
  pv_power: number | null;
  grid_power: number | null;
  load_power: number | null;
  battery_power: number | null;
  work_mode: string | null;
  mqtt_connected: boolean;
  last_updated: string | null;
}

const INITIAL_STATE: InverterState = {
  battery_soc: null,
  pv_power: null,
  grid_power: null,
  load_power: null,
  battery_power: null,
  work_mode: null,
  mqtt_connected: false,
  last_updated: null,
};

// Use globalThis to share state across Next.js workers
const g = globalThis as unknown as {
  __solarbuddy_state?: InverterState;
  __solarbuddy_emitter?: EventEmitter;
};

if (!g.__solarbuddy_state) {
  g.__solarbuddy_state = { ...INITIAL_STATE };
}
if (!g.__solarbuddy_emitter) {
  g.__solarbuddy_emitter = new EventEmitter();
  g.__solarbuddy_emitter.setMaxListeners(100);
}

const state = g.__solarbuddy_state;
const emitter = g.__solarbuddy_emitter;

export function getState(): InverterState {
  return { ...state };
}

export function updateState(partial: Partial<InverterState>) {
  Object.assign(state, partial, { last_updated: new Date().toISOString() });
  emitter.emit('change', getState());
}

export function onStateChange(listener: (state: InverterState) => void) {
  emitter.on('change', listener);
  return () => {
    emitter.off('change', listener);
  };
}
