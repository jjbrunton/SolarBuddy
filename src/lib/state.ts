import { EventEmitter } from 'events';
import type { InverterState } from './types';
import { INITIAL_STATE } from './types';

export type { InverterState };
export { INITIAL_STATE };

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

export function replaceState(nextState: InverterState) {
  Object.assign(state, nextState, { last_updated: new Date().toISOString() });
  emitter.emit('change', getState());
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
