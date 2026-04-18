import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/config';
import { getState } from '@/lib/state';
import {
  enableVirtualInverter,
  getVirtualInverterStatus,
  getVirtualNow,
  getVirtualRates,
  handleVirtualCommand,
  isVirtualModeEnabled,
  listAvailableVirtualScenarios,
  pauseVirtualInverter,
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

  it('clamps a start SOC above 100 to the battery ceiling', () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 250 });
    expect(getVirtualInverterStatus().startSoc).toBe(100);
  });

  it('clamps a negative start SOC to zero', () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: -40 });
    expect(getVirtualInverterStatus().startSoc).toBe(0);
  });

  it('1x speed advances one minute per tick, while 30x advances thirty', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 50, speed: '1x' });
    const t0 = getVirtualInverterStatus().virtualTime!;
    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);
    const t1 = getVirtualInverterStatus().virtualTime!;
    expect(new Date(t1).getTime() - new Date(t0).getTime()).toBe(60 * 1000);

    resetVirtualInverterForTests();
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 50, speed: '30x' });
    const u0 = getVirtualInverterStatus().virtualTime!;
    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);
    const u1 = getVirtualInverterStatus().virtualTime!;
    expect(new Date(u1).getTime() - new Date(u0).getTime()).toBe(30 * 60 * 1000);
  });

  it('falls back to the 6x default when given an unknown speed', async () => {
    enableVirtualInverter({
      scenarioId: 'overnight-recovery',
      startSoc: 50,
      speed: 'warp-factor-9',
    });
    const t0 = getVirtualInverterStatus().virtualTime!;
    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);
    const t1 = getVirtualInverterStatus().virtualTime!;
    expect(new Date(t1).getTime() - new Date(t0).getTime()).toBe(6 * 60 * 1000);
  });

  it('pause halts playback; subsequent ticks do not advance virtual time', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 50 });
    startVirtualInverter();
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = getVirtualInverterStatus().virtualTime;

    pauseVirtualInverter();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getVirtualInverterStatus().virtualTime).toBe(snapshot);
    expect(getVirtualInverterStatus().playbackState).toBe('paused');
  });

  it('handleVirtualCommand transitions hold → charge and raises SOC over time', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 30, speed: '30x' });
    startVirtualInverter();
    handleVirtualCommand('charge', { action: 'charge' });

    const socBefore = getState().battery_soc ?? 0;
    await vi.advanceTimersByTimeAsync(5000); // 5 ticks × 30 minutes = 2.5h of virtual time
    const socAfter = getState().battery_soc ?? 0;

    expect(socAfter).toBeGreaterThan(socBefore);
    expect(socAfter).toBeLessThanOrEqual(100);
  });

  it('handleVirtualCommand transitions hold → discharge and lowers SOC', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 80, speed: '30x' });
    startVirtualInverter();
    handleVirtualCommand('discharge', { action: 'discharge' });

    const socBefore = getState().battery_soc ?? 0;
    await vi.advanceTimersByTimeAsync(5000);
    const socAfter = getState().battery_soc ?? 0;

    expect(socAfter).toBeLessThan(socBefore);
  });

  it('SOC never drops below the configured discharge floor when discharging', async () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 22, speed: '30x' });
    startVirtualInverter();
    handleVirtualCommand('discharge', { action: 'discharge' });

    const floor = parseFloat(DEFAULT_SETTINGS.discharge_soc_floor) || 20;
    await vi.advanceTimersByTimeAsync(30_000); // 30 ticks, plenty to hit the floor

    const soc = getState().battery_soc ?? 0;
    expect(soc).toBeGreaterThanOrEqual(floor - 0.01); // within rounding tolerance
  });

  it('getVirtualRates filters scripted rates by the requested window', () => {
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 50 });
    const all = getVirtualRates();
    expect(all.length).toBeGreaterThan(1);

    const cutoff = all[1].valid_from;
    const filtered = getVirtualRates(cutoff);
    expect(filtered.length).toBeLessThan(all.length);
    expect(filtered.every((r) => r.valid_from >= cutoff)).toBe(true);
  });

  it('getVirtualNow returns wall-clock time when the virtual runtime is disabled', () => {
    resetVirtualInverterForTests();
    const now = getVirtualNow();
    expect(now.getTime()).toBe(new Date().getTime());
  });

  it('listAvailableVirtualScenarios exposes at least the core scenarios', () => {
    const ids = listAvailableVirtualScenarios().map((s) => s.id);
    expect(ids).toContain('overnight-recovery');
    expect(ids).toContain('sunny-surplus');
    expect(ids).toContain('evening-peak');
  });

  it('isVirtualModeEnabled reflects the store flag after enable/reset', () => {
    resetVirtualInverterForTests();
    expect(isVirtualModeEnabled()).toBe(false);
    enableVirtualInverter({ scenarioId: 'overnight-recovery', startSoc: 50 });
    expect(isVirtualModeEnabled()).toBe(true);
    resetVirtualInverterForTests();
    expect(isVirtualModeEnabled()).toBe(false);
  });
});
