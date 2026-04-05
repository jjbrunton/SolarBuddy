import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRecentMqttLogsMock, getMqttLogsAfterMock } = vi.hoisted(() => ({
  getRecentMqttLogsMock: vi.fn(),
  getMqttLogsAfterMock: vi.fn(),
}));

vi.mock('@/lib/mqtt/logs', () => ({
  getRecentMqttLogs: getRecentMqttLogsMock,
  getMqttLogsAfter: getMqttLogsAfterMock,
}));

import { GET } from './route';

function decodeChunk(value?: Uint8Array) {
  return new TextDecoder().decode(value);
}

describe('/api/system/mqtt-log GET', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams a snapshot followed by polled entries', async () => {
    getRecentMqttLogsMock.mockReturnValue([
      {
        id: 1,
        timestamp: '2026-04-05T10:00:00.000Z',
        level: 'info',
        direction: 'system',
        topic: null,
        payload: 'initial',
      },
    ]);
    getMqttLogsAfterMock
      .mockReturnValueOnce([
        {
          id: 2,
          timestamp: '2026-04-05T10:00:01.000Z',
          level: 'success',
          direction: 'inbound',
          topic: 'homeassistant/status',
          payload: 'online',
        },
      ])
      .mockReturnValue([]);

    const controller = new AbortController();
    const response = await GET(new Request('http://localhost/api/system/mqtt-log', { signal: controller.signal }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const snapshotChunk = await reader!.read();
    expect(decodeChunk(snapshotChunk.value)).toContain('"type":"snapshot"');
    expect(decodeChunk(snapshotChunk.value)).toContain('"id":1');

    await vi.advanceTimersByTimeAsync(1000);
    const entryChunk = await reader!.read();
    expect(decodeChunk(entryChunk.value)).toContain('"type":"entry"');
    expect(decodeChunk(entryChunk.value)).toContain('"id":2');

    controller.abort();
    const done = await reader!.read();
    expect(done.done).toBe(true);
  });

  it('emits keep-alive pings while waiting for entries', async () => {
    getRecentMqttLogsMock.mockReturnValue([]);
    getMqttLogsAfterMock.mockReturnValue([]);

    const response = await GET(new Request('http://localhost/api/system/mqtt-log'));
    const reader = response.body!.getReader();

    const snapshotChunk = await reader.read();
    expect(decodeChunk(snapshotChunk.value)).toContain('"type":"snapshot"');

    await vi.advanceTimersByTimeAsync(30_000);
    const pingChunk = await reader.read();
    expect(decodeChunk(pingChunk.value)).toContain(': ping');

    await reader.cancel();
  });
});
