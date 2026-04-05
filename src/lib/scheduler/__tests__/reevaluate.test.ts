import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appendEventMock,
  replanFromStoredRatesMock,
  getStateMock,
  onStateChangeMock,
} = vi.hoisted(() => ({
  appendEventMock: vi.fn(),
  replanFromStoredRatesMock: vi.fn(),
  getStateMock: vi.fn(),
  onStateChangeMock: vi.fn(),
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

vi.mock('../cron', () => ({
  replanFromStoredRates: replanFromStoredRatesMock,
}));

vi.mock('../../state', () => ({
  getState: getStateMock,
  onStateChange: onStateChangeMock,
}));

import {
  _resetForTests,
  requestReplan,
  scheduleStartupReplan,
} from '../reevaluate';

describe('scheduler reevaluate', () => {
  let listeners: Array<(state: { mqtt_connected: boolean }) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T00:00:00.000Z'));
    vi.clearAllMocks();
    _resetForTests();

    listeners = [];
    getStateMock.mockReturnValue({ mqtt_connected: false });
    onStateChangeMock.mockImplementation((listener: (state: { mqtt_connected: boolean }) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    });

    replanFromStoredRatesMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _resetForTests();
    vi.useRealTimers();
  });

  it('debounces rapid replan requests and keeps the latest reason', async () => {
    requestReplan('settings changed');
    await vi.advanceTimersByTimeAsync(4000);
    expect(replanFromStoredRatesMock).not.toHaveBeenCalled();

    requestReplan('manual override changed');
    await vi.advanceTimersByTimeAsync(5000);

    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        category: 'scheduler',
        message: 'Schedule replan triggered: manual override changed',
      }),
    );
  });

  it('enforces a minimum interval between completed replans', async () => {
    requestReplan('first');
    await vi.advanceTimersByTimeAsync(5000);
    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);

    requestReplan('second');
    await vi.advanceTimersByTimeAsync(5000);
    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(2);
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Schedule replan triggered: second',
      }),
    );
  });

  it('runs startup replan immediately after startup delay when MQTT is already connected', async () => {
    getStateMock.mockReturnValue({ mqtt_connected: true });

    scheduleStartupReplan();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Schedule replan triggered: startup (MQTT connected)',
      }),
    );
  });

  it('waits for MQTT connection after startup delay before triggering replan', async () => {
    getStateMock.mockReturnValue({ mqtt_connected: false });

    scheduleStartupReplan();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(replanFromStoredRatesMock).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(1);

    listeners[0]({ mqtt_connected: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Schedule replan triggered: startup (MQTT connected)',
      }),
    );
  });

  it('falls back to timeout startup replan if MQTT never connects', async () => {
    getStateMock.mockReturnValue({ mqtt_connected: false });

    scheduleStartupReplan();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(replanFromStoredRatesMock).toHaveBeenCalledTimes(1);
    expect(appendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Schedule replan triggered: startup (MQTT timeout)',
      }),
    );
  });
});
