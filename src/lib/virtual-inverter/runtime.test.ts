import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/config';
import { getState } from '@/lib/state';
import {
  enableVirtualInverter,
  getVirtualInverterStatus,
  resetVirtualInverter,
  resetVirtualInverterForTests,
  startVirtualInverter,
} from './runtime';

vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    getSettings: () => DEFAULT_SETTINGS,
  };
});

vi.mock('@/lib/events', () => ({
  appendEvent: vi.fn(),
}));

vi.mock('@/lib/mqtt/logs', () => ({
  appendMqttLog: vi.fn(),
}));

describe('virtual inverter runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T10:00:00Z'));
    resetVirtualInverterForTests();
  });

  afterEach(() => {
    resetVirtualInverterForTests();
    vi.useRealTimers();
  });

  it('enables the virtual runtime and seeds shared state from the selected scenario', () => {
    enableVirtualInverter({ scenarioId: 'sunny-surplus', startSoc: 44 });

    const state = getState();
    expect(state.runtime_mode).toBe('virtual');
    expect(state.virtual_scenario_id).toBe('sunny-surplus');
    expect(state.virtual_scenario_name).toBe('Sunny Surplus Day');
    expect(state.battery_soc).toBeGreaterThanOrEqual(44);
    expect(getVirtualInverterStatus().enabled).toBe(true);
  });

  it('advances virtual time while running', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 20, speed: '30x' });
    const initialTime = getVirtualInverterStatus().virtualTime;

    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);

    const nextTime = getVirtualInverterStatus().virtualTime;
    expect(initialTime).not.toBeNull();
    expect(nextTime).not.toBe(initialTime);
    expect(new Date(nextTime!).getTime() - new Date(initialTime!).getTime()).toBe(30 * 60 * 1000);
  });

  it('resets the scenario back to its initial scripted point', async () => {
    enableVirtualInverter({ scenarioId: 'evening-peak', startSoc: 70 });
    const initialTime = getVirtualInverterStatus().virtualTime;

    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);
    resetVirtualInverter({ startSoc: 55 });

    const status = getVirtualInverterStatus();
    expect(status.playbackState).toBe('stopped');
    expect(status.virtualTime).toBe(initialTime);
    expect(getState().battery_soc).toBeGreaterThanOrEqual(55);
  });
});
