import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setBatteryChargeRate,
  setBatteryFirstStopCharge,
  setChargerSourcePriority,
  setLoadFirstStopDischarge,
  setMaxGridChargeCurrent,
  setOutputSourcePriority,
  setShutdownBatteryVoltage,
  setWorkMode,
  startBatteryHold,
  startGridCharging,
  startGridDischarge,
  stopGridCharging,
  stopGridDischarge,
  syncDateTime,
} from '../commands';
import { COMMAND_TOPICS } from '../topics';

const { getMqttClientMock, appendMqttLogMock } = vi.hoisted(() => ({
  getMqttClientMock: vi.fn(),
  appendMqttLogMock: vi.fn(),
}));

vi.mock('../client', () => ({
  getMqttClient: getMqttClientMock,
}));

vi.mock('../logs', () => ({
  appendMqttLog: appendMqttLogMock,
}));

describe('mqtt commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs and rejects when MQTT is disconnected', async () => {
    getMqttClientMock.mockReturnValue(null);

    await expect(setWorkMode('Grid first')).rejects.toThrow('MQTT not connected');

    expect(appendMqttLogMock).toHaveBeenCalledWith({
      level: 'error',
      direction: 'outbound',
      topic: COMMAND_TOPICS.workMode,
      payload: 'Grid first',
    });
  });

  it('logs publish errors from the MQTT client', async () => {
    const publish = vi.fn((topic, payload, options, callback) => {
      callback(new Error(`failed:${topic}:${payload}:${options.qos}`));
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await expect(setBatteryChargeRate(75)).rejects.toThrow(
      `failed:${COMMAND_TOPICS.batteryChargeRate}:75:1`,
    );

    expect(appendMqttLogMock).toHaveBeenCalledWith({
      level: 'error',
      direction: 'outbound',
      topic: COMMAND_TOPICS.batteryChargeRate,
      payload: '75',
    });
  });

  it.each([
    {
      label: 'battery charge rate',
      run: () => setBatteryChargeRate(75),
      topic: COMMAND_TOPICS.batteryChargeRate,
      payload: '75',
    },
    {
      label: 'battery-first stop charge',
      run: () => setBatteryFirstStopCharge(100),
      topic: COMMAND_TOPICS.batteryFirstStopCharge,
      payload: '100',
    },
    {
      label: 'output source priority',
      run: () => setOutputSourcePriority('SBU'),
      topic: COMMAND_TOPICS.outputSourcePriority,
      payload: 'SBU',
    },
    {
      label: 'charger source priority',
      run: () => setChargerSourcePriority('SOL'),
      topic: COMMAND_TOPICS.chargerSourcePriority,
      payload: 'SOL',
    },
    {
      label: 'max grid charge current',
      run: () => setMaxGridChargeCurrent(60),
      topic: COMMAND_TOPICS.maxGridChargeCurrent,
      payload: '60',
    },
    {
      label: 'load-first stop discharge',
      run: () => setLoadFirstStopDischarge(33),
      topic: COMMAND_TOPICS.loadFirstStopDischarge,
      payload: '33',
    },
    {
      label: 'shutdown battery voltage',
      run: () => setShutdownBatteryVoltage(47.8),
      topic: COMMAND_TOPICS.shutdownBatteryVoltage,
      payload: '47.8',
    },
    {
      label: 'date and time sync',
      run: () => syncDateTime('2026-04-03 09:15:27'),
      topic: COMMAND_TOPICS.dateTime,
      payload: '2026-04-03 09:15:27',
    },
  ])('publishes $label with a success log', async ({ run, topic, payload }) => {
    const publish = vi.fn((requestedTopic, requestedPayload, options, callback) => {
      callback(null);
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await run();

    expect(publish).toHaveBeenCalledWith(topic, payload, { qos: 1 }, expect.any(Function));
    expect(appendMqttLogMock).toHaveBeenCalledWith({
      level: 'success',
      direction: 'outbound',
      topic,
      payload,
    });
  });

  it('publishes the grid charging sequence in order', async () => {
    const publish = vi.fn((topic, payload, options, callback) => {
      callback(null);
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await startGridCharging(88);

    // Stop charge is raised to 100% first so Growatt firmware doesn't exit
    // Battery first mode the instant our work-mode write lands.
    expect(publish.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual([
      [COMMAND_TOPICS.batteryFirstStopCharge, '100'],
      [COMMAND_TOPICS.batteryChargeRate, '88'],
      [COMMAND_TOPICS.workMode, 'Battery first'],
    ]);
  });

  it('restores the requested default mode when grid charging stops', async () => {
    const publish = vi.fn((topic, payload, options, callback) => {
      callback(null);
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await stopGridCharging('Load first');

    expect(publish.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual([
      [COMMAND_TOPICS.workMode, 'Load first'],
    ]);
  });

  it('switches discharge mode on and off using the expected priorities', async () => {
    const publish = vi.fn((topic, payload, options, callback) => {
      callback(null);
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await startGridDischarge('Load first');
    await stopGridDischarge('Load first');

    expect(publish.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual([
      [COMMAND_TOPICS.workMode, 'Load first'],
      [COMMAND_TOPICS.workMode, 'Load first'],
    ]);
  });

  it('publishes the full battery-hold sequence with the current SOC', async () => {
    const publish = vi.fn((topic, payload, options, callback) => {
      callback(null);
    });
    getMqttClientMock.mockReturnValue({ connected: true, publish });

    await startBatteryHold(57);

    expect(publish.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual([
      [COMMAND_TOPICS.workMode, 'Load first'],
      [COMMAND_TOPICS.loadFirstStopDischarge, '57'],
    ]);
  });
});
