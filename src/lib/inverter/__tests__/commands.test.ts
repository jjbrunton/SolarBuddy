import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handleVirtualCommandMock,
  isVirtualModeEnabledMock,
  realMocks,
} = vi.hoisted(() => ({
  handleVirtualCommandMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(),
  realMocks: {
    setWorkMode: vi.fn(),
    setBatteryChargeRate: vi.fn(),
    startGridCharging: vi.fn(),
    stopGridCharging: vi.fn(),
    startGridDischarge: vi.fn(),
    stopGridDischarge: vi.fn(),
    startBatteryHold: vi.fn(),
    setLoadFirstStopDischarge: vi.fn(),
    setOutputSourcePriority: vi.fn(),
    setChargerSourcePriority: vi.fn(),
    setMaxGridChargeCurrent: vi.fn(),
    setShutdownBatteryVoltage: vi.fn(),
    syncDateTime: vi.fn(),
  },
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  handleVirtualCommand: handleVirtualCommandMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
}));

vi.mock('@/lib/mqtt/commands', () => realMocks);

import {
  setWorkMode,
  setBatteryChargeRate,
  startGridCharging,
  stopGridCharging,
  startGridDischarge,
  stopGridDischarge,
  startBatteryHold,
  setLoadFirstStopDischarge,
  setOutputSourcePriority,
  setChargerSourcePriority,
  setMaxGridChargeCurrent,
  setShutdownBatteryVoltage,
  syncDateTime,
} from '../commands';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inverter command adapter — real mode', () => {
  beforeEach(() => {
    isVirtualModeEnabledMock.mockReturnValue(false);
  });

  it('routes every helper to its MQTT counterpart with the same args', async () => {
    await setWorkMode('Battery first');
    await setBatteryChargeRate(80);
    await startGridCharging(90);
    await stopGridCharging('Load first');
    await startGridDischarge('Load first');
    await stopGridDischarge('Battery first');
    await startBatteryHold(55);
    await setLoadFirstStopDischarge(30);
    await setOutputSourcePriority('SBU');
    await setChargerSourcePriority('Solar first');
    await setMaxGridChargeCurrent(40);
    await setShutdownBatteryVoltage(48);
    await syncDateTime('2026-04-16 10:00:00');

    expect(realMocks.setWorkMode).toHaveBeenCalledWith('Battery first');
    expect(realMocks.setBatteryChargeRate).toHaveBeenCalledWith(80);
    expect(realMocks.startGridCharging).toHaveBeenCalledWith(90);
    expect(realMocks.stopGridCharging).toHaveBeenCalledWith('Load first');
    expect(realMocks.startGridDischarge).toHaveBeenCalledWith('Load first');
    expect(realMocks.stopGridDischarge).toHaveBeenCalledWith('Battery first');
    expect(realMocks.startBatteryHold).toHaveBeenCalledWith(55);
    expect(realMocks.setLoadFirstStopDischarge).toHaveBeenCalledWith(30);
    expect(realMocks.setOutputSourcePriority).toHaveBeenCalledWith('SBU');
    expect(realMocks.setChargerSourcePriority).toHaveBeenCalledWith('Solar first');
    expect(realMocks.setMaxGridChargeCurrent).toHaveBeenCalledWith(40);
    expect(realMocks.setShutdownBatteryVoltage).toHaveBeenCalledWith(48);
    expect(realMocks.syncDateTime).toHaveBeenCalledWith('2026-04-16 10:00:00');
    expect(handleVirtualCommandMock).not.toHaveBeenCalled();
  });
});

describe('inverter command adapter — virtual mode', () => {
  beforeEach(() => {
    isVirtualModeEnabledMock.mockReturnValue(true);
  });

  it('startGridCharging emits a charge action with Grid-first + USB', async () => {
    await startGridCharging(75);
    expect(realMocks.startGridCharging).not.toHaveBeenCalled();
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.stringContaining('75%'),
      { action: 'charge', workMode: 'Grid first', batteryFirstChargeRate: 75, batteryFirstStopCharge: 100, outputSourcePriority: 'USB' },
    );
  });

  it('stopGridCharging emits a hold with the default mode', async () => {
    await stopGridCharging();
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.stringContaining('Battery first'),
      { action: 'hold', workMode: 'Battery first' },
    );
  });

  it('startGridDischarge emits a discharge with SBU output', async () => {
    await startGridDischarge();
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.stringContaining('Load first'),
      { action: 'discharge', workMode: 'Load first', outputSourcePriority: 'SBU' },
    );
  });

  it('stopGridDischarge restores USB output and holds', async () => {
    await stopGridDischarge();
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      { action: 'hold', workMode: 'Battery first', outputSourcePriority: 'USB' },
    );
  });

  it('startBatteryHold uses SOC as the stop-discharge threshold', async () => {
    await startBatteryHold(45);
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.stringContaining('45%'),
      {
        action: 'hold',
        workMode: 'Load first',
        outputSourcePriority: 'USB',
        loadFirstStopDischarge: 45,
      },
    );
  });

  it('setBatteryChargeRate patches only the new rate', async () => {
    await setBatteryChargeRate(60);
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      { batteryFirstChargeRate: 60 },
    );
  });

  it('setLoadFirstStopDischarge patches only the new threshold', async () => {
    await setLoadFirstStopDischarge(20);
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      { loadFirstStopDischarge: 20 },
    );
  });

  it('setOutputSourcePriority patches only the new priority', async () => {
    await setOutputSourcePriority('SBU');
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      { outputSourcePriority: 'SBU' },
    );
  });

  it('setWorkMode patches only the new work mode', async () => {
    await setWorkMode('Load first');
    expect(handleVirtualCommandMock).toHaveBeenCalledWith(
      expect.stringContaining('Load first'),
      { workMode: 'Load first' },
    );
  });

  it('commands without meaningful virtual state send just a log message', async () => {
    await setChargerSourcePriority('Solar first');
    await setMaxGridChargeCurrent(30);
    await setShutdownBatteryVoltage(46);
    await syncDateTime('2026-04-16 10:00:00');

    expect(handleVirtualCommandMock).toHaveBeenCalledTimes(4);
    for (const call of handleVirtualCommandMock.mock.calls) {
      expect(call).toHaveLength(1);
    }
    expect(realMocks.setChargerSourcePriority).not.toHaveBeenCalled();
  });
});
