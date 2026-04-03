import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncInverterTime } from '../time-sync';

const { syncDateTimeMock, appendEventMock } = vi.hoisted(() => ({
  syncDateTimeMock: vi.fn(),
  appendEventMock: vi.fn(),
}));

vi.mock('../../mqtt/commands', () => ({
  syncDateTime: syncDateTimeMock,
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

describe('syncInverterTime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats the current time for Solar Assistant and records a success event', async () => {
    vi.setSystemTime(new Date('2026-01-03T09:15:27Z'));
    syncDateTimeMock.mockResolvedValue(undefined);

    const result = await syncInverterTime();

    expect(syncDateTimeMock).toHaveBeenCalledWith('2026-01-03 09:15:27');
    expect(appendEventMock).toHaveBeenCalledWith({
      level: 'info',
      category: 'time-sync',
      message: 'Inverter clock synced to 2026-01-03 09:15:27',
    });
    expect(result).toEqual({
      synced: true,
      message: 'Inverter clock synced to 2026-01-03 09:15:27',
    });
  });

  it('records an unknown error when the MQTT command rejects without an Error instance', async () => {
    vi.setSystemTime(new Date('2026-01-03T09:15:27Z'));
    syncDateTimeMock.mockRejectedValue('bad');

    const result = await syncInverterTime();

    expect(appendEventMock).toHaveBeenCalledWith({
      level: 'error',
      category: 'time-sync',
      message: 'Time sync failed: Unknown error',
    });
    expect(result).toEqual({
      synced: false,
      message: 'Time sync failed: Unknown error',
    });
  });
});
