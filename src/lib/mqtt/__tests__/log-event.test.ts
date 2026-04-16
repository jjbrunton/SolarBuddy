import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logMqttEvent, logMqttSystem } from '../log-event';

const { appendEventMock, appendMqttLogMock } = vi.hoisted(() => ({
  appendEventMock: vi.fn(),
  appendMqttLogMock: vi.fn(),
}));

vi.mock('../../events', () => ({ appendEvent: appendEventMock }));
vi.mock('../logs', () => ({ appendMqttLog: appendMqttLogMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logMqttEvent', () => {
  it('writes to both the event log and the MQTT log with matching level', () => {
    logMqttEvent('warning', 'reconnecting');

    expect(appendEventMock).toHaveBeenCalledWith({
      level: 'warning',
      category: 'mqtt',
      message: 'reconnecting',
    });
    expect(appendMqttLogMock).toHaveBeenCalledWith({
      level: 'warning',
      direction: 'system',
      topic: null,
      payload: 'reconnecting',
    });
  });
});

describe('logMqttSystem', () => {
  it('only writes to the MQTT log (no event log entry)', () => {
    logMqttSystem('info', 'subscribed to topic foo');

    expect(appendEventMock).not.toHaveBeenCalled();
    expect(appendMqttLogMock).toHaveBeenCalledWith({
      level: 'info',
      direction: 'system',
      topic: null,
      payload: 'subscribed to topic foo',
    });
  });
});
