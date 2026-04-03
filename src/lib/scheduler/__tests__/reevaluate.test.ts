import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InverterState } from '../../types';

const { replanMock, appendEventMock, getStateMock, onStateChangeMock } = vi.hoisted(() => ({
  replanMock: vi.fn().mockResolvedValue({ ok: true, status: 'scheduled', message: '', windowsCount: 1 }),
  appendEventMock: vi.fn(),
  getStateMock: vi.fn(() => ({ mqtt_connected: false })),
  onStateChangeMock: vi.fn(() => vi.fn()),
}));

vi.mock('../cron', () => ({
  replanFromStoredRates: replanMock,
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

vi.mock('../../state', () => ({
  getState: getStateMock,
  onStateChange: onStateChangeMock,
}));

import { requestReplan, scheduleStartupReplan, _resetForTests } from '../reevaluate';

describe('reevaluate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTests();
    replanMock.mockClear();
    appendEventMock.mockClear();
    getStateMock.mockClear();
    onStateChangeMock.mockClear();
  });

  afterEach(() => {
    _resetForTests();
    vi.useRealTimers();
  });

  describe('requestReplan', () => {
    it('debounces rapid calls into a single execution', async () => {
      requestReplan('change 1');
      requestReplan('change 2');
      requestReplan('change 3');

      // Debounce hasn't fired yet
      expect(replanMock).not.toHaveBeenCalled();

      // Advance past the 5-second debounce
      await vi.advanceTimersByTimeAsync(5_000);

      expect(replanMock).toHaveBeenCalledTimes(1);
    });

    it('respects the 60-second minimum interval', async () => {
      requestReplan('first');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(replanMock).toHaveBeenCalledTimes(1);

      // Request again immediately
      requestReplan('second');
      await vi.advanceTimersByTimeAsync(5_000);

      // Should not have run again — still within 60-second interval
      expect(replanMock).toHaveBeenCalledTimes(1);

      // Advance to 60 seconds after first completion
      await vi.advanceTimersByTimeAsync(55_000);
      expect(replanMock).toHaveBeenCalledTimes(2);
    });

    it('queues a follow-up when called during an in-flight run', async () => {
      let resolveFirst!: () => void;
      replanMock.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
      );

      requestReplan('first');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(replanMock).toHaveBeenCalledTimes(1);

      // Request while first is in-flight, then advance past debounce
      // so executeReplan sees the in-flight flag and queues the reason
      requestReplan('queued');
      await vi.advanceTimersByTimeAsync(5_000);

      // Resolve the first run — queued follow-up should fire
      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);

      expect(replanMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduleStartupReplan', () => {
    it('runs after 30s delay when MQTT is already connected', async () => {
      getStateMock.mockReturnValue({ mqtt_connected: true });

      scheduleStartupReplan();
      expect(replanMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(replanMock).toHaveBeenCalledTimes(1);
    });

    it('waits for MQTT connection after initial delay', async () => {
      getStateMock.mockReturnValue({ mqtt_connected: false });
      let stateListener: ((state: Partial<InverterState>) => void) | null = null;
      onStateChangeMock.mockImplementation((listener: (state: Partial<InverterState>) => void) => {
        stateListener = listener;
        return vi.fn();
      });

      scheduleStartupReplan();

      // After 30s, should subscribe to state changes
      await vi.advanceTimersByTimeAsync(30_000);
      expect(replanMock).not.toHaveBeenCalled();
      expect(onStateChangeMock).toHaveBeenCalled();

      // Simulate MQTT connecting
      stateListener!({ mqtt_connected: true } as Partial<InverterState>);
      await vi.advanceTimersByTimeAsync(0);
      expect(replanMock).toHaveBeenCalledTimes(1);
    });

    it('runs with hard cap if MQTT never connects', async () => {
      getStateMock.mockReturnValue({ mqtt_connected: false });
      onStateChangeMock.mockImplementation(() => vi.fn());

      scheduleStartupReplan();

      // After 30s, not connected
      await vi.advanceTimersByTimeAsync(30_000);
      expect(replanMock).not.toHaveBeenCalled();

      // Advance to hard cap (5 minutes total - 30s already elapsed = 4.5 minutes)
      await vi.advanceTimersByTimeAsync(4.5 * 60_000);
      expect(replanMock).toHaveBeenCalledTimes(1);
    });
  });
});
