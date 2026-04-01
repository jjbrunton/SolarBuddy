import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendMqttLog,
  getMqttLogsAfter,
  getRecentMqttLogs,
  resetMqttLogsForTests,
} from '../logs';

describe('mqtt log buffer', () => {
  beforeEach(() => {
    resetMqttLogsForTests();
  });

  it('stores recent entries in append order', () => {
    appendMqttLog({
      level: 'info',
      direction: 'system',
      topic: null,
      payload: 'Connecting',
    });
    appendMqttLog({
      level: 'success',
      direction: 'inbound',
      topic: 'solar_assistant/inverter_1/pv_power/state',
      payload: '1234',
    });

    expect(getRecentMqttLogs()).toMatchObject([
      {
        level: 'info',
        direction: 'system',
        topic: null,
        payload: 'Connecting',
      },
      {
        level: 'success',
        direction: 'inbound',
        topic: 'solar_assistant/inverter_1/pv_power/state',
        payload: '1234',
      },
    ]);
  });

  it('trims long payloads for display safety', () => {
    const entry = appendMqttLog({
      level: 'info',
      direction: 'inbound',
      topic: 'solar_assistant/test',
      payload: `${'x'.repeat(240)}tail`,
    });

    expect(entry.payload).toHaveLength(240);
    expect(entry.payload.endsWith('...')).toBe(true);
  });

  it('returns entries added after a known id', () => {
    const first = appendMqttLog({
      level: 'warning',
      direction: 'outbound',
      topic: 'solar_assistant/inverter_1/work_mode_priority/set',
      payload: 'Grid first',
    });
    appendMqttLog({
      level: 'info',
      direction: 'inbound',
      topic: 'solar_assistant/set/response_message/state',
      payload: 'Accepted',
    });

    expect(getMqttLogsAfter(first.id).map((entry) => entry.payload)).toEqual(['Accepted']);
  });
});
