import { afterEach, describe, expect, it, vi } from 'vitest';
import { getState, INITIAL_STATE, onStateChange, updateState } from '../state';

describe('state store', () => {
  const originalState = getState();

  afterEach(() => {
    vi.useRealTimers();
    updateState({ ...originalState, last_updated: originalState.last_updated });
  });

  it('returns a copy of the current state', () => {
    const snapshot = getState();
    snapshot.battery_soc = 99;

    expect(getState().battery_soc).toBe(originalState.battery_soc);
  });

  it('updates the shared state and stamps the last_updated field', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));

    updateState({ battery_soc: 67, mqtt_connected: true });

    expect(getState()).toMatchObject({
      ...INITIAL_STATE,
      ...originalState,
      battery_soc: 67,
      mqtt_connected: true,
      last_updated: '2026-04-03T12:00:00.000Z',
    });
  });

  it('notifies listeners and supports unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = onStateChange(listener);

    updateState({ battery_soc: 41 });
    unsubscribe();
    updateState({ battery_soc: 42 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ battery_soc: 41 }));
  });
});
