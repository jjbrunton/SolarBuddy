import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handleVirtualCommandMock,
  isVirtualModeEnabledMock,
  startRealGridChargingMock,
  stopRealGridChargingMock,
} = vi.hoisted(() => ({
  handleVirtualCommandMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(),
  startRealGridChargingMock: vi.fn(),
  stopRealGridChargingMock: vi.fn(),
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  handleVirtualCommand: handleVirtualCommandMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
}));

vi.mock('@/lib/mqtt/commands', () => ({
  startGridCharging: startRealGridChargingMock,
  stopGridCharging: stopRealGridChargingMock,
  setWorkMode: vi.fn(),
  setGridChargeRate: vi.fn(),
  startGridDischarge: vi.fn(),
  stopGridDischarge: vi.fn(),
  startBatteryHold: vi.fn(),
  setLoadFirstStopDischarge: vi.fn(),
  setOutputSourcePriority: vi.fn(),
  setChargerSourcePriority: vi.fn(),
  setMaxGridChargeCurrent: vi.fn(),
  setShutdownBatteryVoltage: vi.fn(),
  syncDateTime: vi.fn(),
}));

import { startGridCharging, stopGridCharging } from '../commands';

describe('inverter command adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks real MQTT commands when virtual mode is enabled', async () => {
    isVirtualModeEnabledMock.mockReturnValue(true);

    await startGridCharging(80);

    expect(handleVirtualCommandMock).toHaveBeenCalled();
    expect(startRealGridChargingMock).not.toHaveBeenCalled();
  });

  it('passes through to MQTT commands in real mode', async () => {
    isVirtualModeEnabledMock.mockReturnValue(false);

    await stopGridCharging('Battery first');

    expect(stopRealGridChargingMock).toHaveBeenCalledWith('Battery first');
    expect(handleVirtualCommandMock).not.toHaveBeenCalled();
  });
});
