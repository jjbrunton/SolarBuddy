import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  disableVirtualInverterMock,
  enableVirtualInverterMock,
  getVirtualInverterStatusMock,
  isVirtualModeEnabledMock,
  listAvailableVirtualScenariosMock,
  pauseVirtualInverterMock,
  resetVirtualInverterMock,
  startVirtualInverterMock,
} = vi.hoisted(() => ({
  disableVirtualInverterMock: vi.fn(),
  enableVirtualInverterMock: vi.fn(),
  getVirtualInverterStatusMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(),
  listAvailableVirtualScenariosMock: vi.fn(),
  pauseVirtualInverterMock: vi.fn(),
  resetVirtualInverterMock: vi.fn(),
  startVirtualInverterMock: vi.fn(),
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  disableVirtualInverter: disableVirtualInverterMock,
  enableVirtualInverter: enableVirtualInverterMock,
  getVirtualInverterStatus: getVirtualInverterStatusMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
  listAvailableVirtualScenarios: listAvailableVirtualScenariosMock,
  pauseVirtualInverter: pauseVirtualInverterMock,
  resetVirtualInverter: resetVirtualInverterMock,
  startVirtualInverter: startVirtualInverterMock,
}));

import { GET as getRuntime, POST as postRuntime } from './route';
import { GET as getScenarios } from './scenarios/route';

describe('/api/virtual-inverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVirtualModeEnabledMock.mockReturnValue(true);
    getVirtualInverterStatusMock.mockReturnValue({
      enabled: true,
      scenarioId: 'overnight-recovery',
      scenarioName: 'Low Battery Overnight Recovery',
      playbackState: 'paused',
      speed: '6x',
      virtualTime: '2026-04-04T10:00:00Z',
      startSoc: 20,
      loadMultiplier: 1,
      availableControls: ['start', 'pause', 'reset', 'disable'],
    });
    listAvailableVirtualScenariosMock.mockReturnValue([
      { id: 'overnight-recovery', name: 'Low Battery Overnight Recovery' },
    ]);
  });

  it('returns the current virtual runtime status', async () => {
    const response = await getRuntime();
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: 'virtual',
      scenarioId: 'overnight-recovery',
      playbackState: 'paused',
    });
  });

  it('routes control actions to the runtime service', async () => {
    const response = await postRuntime(
      new Request('http://localhost/api/virtual-inverter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reset', startSoc: 33, loadMultiplier: 1.5 }),
      }),
    );

    expect(resetVirtualInverterMock).toHaveBeenCalledWith({ startSoc: 33, loadMultiplier: 1.5 });
    expect(await response.json()).toMatchObject({ ok: true, mode: 'virtual' });
  });

  it('lists the available scenario presets', async () => {
    const response = await getScenarios();
    expect(await response.json()).toEqual({
      scenarios: [{ id: 'overnight-recovery', name: 'Low Battery Overnight Recovery' }],
    });
  });
});
