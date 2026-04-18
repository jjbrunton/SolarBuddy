import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStateMock, prepareMock, runMock, getDbMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  prepareMock: vi.fn(),
  runMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('../../state', () => ({ getState: getStateMock }));
vi.mock('../../db', () => ({ getDb: getDbMock }));

import { startReadingsIngestion, stopReadingsIngestion } from '../ingest';

const CONNECTED_STATE = {
  mqtt_connected: true,
  runtime_mode: 'real',
  battery_soc: 55,
  pv_power: 1500,
  grid_power: -300,
  load_power: 1200,
  battery_voltage: 52.5,
  battery_temperature: 24,
  inverter_temperature: 32,
  grid_voltage: 232,
  grid_frequency: 50,
  pv_power_1: 800,
  pv_power_2: 700,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  prepareMock.mockReturnValue({ run: runMock });
  getDbMock.mockReturnValue({ prepare: prepareMock });
  getStateMock.mockReturnValue(CONNECTED_STATE);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stopReadingsIngestion();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startReadingsIngestion', () => {
  it('schedules an insert every 60 seconds while MQTT is connected', () => {
    startReadingsIngestion();
    // No immediate snapshot — the function schedules on interval only.
    expect(runMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(runMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent: a second start call does not create a second timer', () => {
    startReadingsIngestion();
    startReadingsIngestion();
    vi.advanceTimersByTime(60_000);
    // Still exactly one tick fired, not two.
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});

describe('stopReadingsIngestion', () => {
  it('clears the timer and prevents further snapshots', () => {
    startReadingsIngestion();
    stopReadingsIngestion();
    vi.advanceTimersByTime(300_000);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('allows restart after stop', () => {
    startReadingsIngestion();
    stopReadingsIngestion();
    startReadingsIngestion();
    vi.advanceTimersByTime(60_000);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});

describe('snapshot gating', () => {
  it('skips the insert when MQTT is disconnected', () => {
    getStateMock.mockReturnValue({ ...CONNECTED_STATE, mqtt_connected: false });
    startReadingsIngestion();
    vi.advanceTimersByTime(60_000);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("skips the insert when runtime_mode is 'virtual'", () => {
    getStateMock.mockReturnValue({ ...CONNECTED_STATE, runtime_mode: 'virtual' });
    startReadingsIngestion();
    vi.advanceTimersByTime(60_000);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('binds every telemetry field in the INSERT call', () => {
    startReadingsIngestion();
    vi.advanceTimersByTime(60_000);

    expect(runMock).toHaveBeenCalledTimes(1);
    const args = runMock.mock.calls[0];
    // timestamp + 11 telemetry columns = 12 positional params.
    expect(args).toHaveLength(12);
    // First arg is an ISO timestamp, rest are the state fields in declared order.
    expect(typeof args[0]).toBe('string');
    expect(new Date(args[0] as string).toString()).not.toBe('Invalid Date');
    expect(args.slice(1)).toEqual([
      CONNECTED_STATE.battery_soc,
      CONNECTED_STATE.pv_power,
      CONNECTED_STATE.grid_power,
      CONNECTED_STATE.load_power,
      CONNECTED_STATE.battery_voltage,
      CONNECTED_STATE.battery_temperature,
      CONNECTED_STATE.inverter_temperature,
      CONNECTED_STATE.grid_voltage,
      CONNECTED_STATE.grid_frequency,
      CONNECTED_STATE.pv_power_1,
      CONNECTED_STATE.pv_power_2,
    ]);
  });
});

describe('error recovery', () => {
  it('swallows db errors and keeps ticking (timer survives a failed insert)', () => {
    runMock
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      })
      .mockImplementation(() => undefined);

    startReadingsIngestion();
    vi.advanceTimersByTime(60_000); // failing tick
    vi.advanceTimersByTime(60_000); // recovering tick

    expect(runMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[Readings] Insert failed:'),
      expect.any(String),
    );
  });
});
