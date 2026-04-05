import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mqtt_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      direction TEXT NOT NULL,
      topic TEXT,
      payload TEXT NOT NULL
    );
  `);
  return { testDb: db };
});

vi.mock('@/lib/db', () => ({
  getDb: () => testDb,
}));

import { appendMqttLog, resetMqttLogsForTests } from '@/lib/mqtt/logs';
import { GET } from './route';

function decodeChunk(value?: Uint8Array) {
  return new TextDecoder().decode(value);
}

describe('/api/system/mqtt-log stream integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMqttLogsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams snapshot then publishes newly appended MQTT log entries', async () => {
    const controller = new AbortController();
    const response = await GET(
      new Request('http://localhost/api/system/mqtt-log', { signal: controller.signal }),
    );

    const reader = response.body!.getReader();
    const snapshotChunk = await reader.read();
    expect(decodeChunk(snapshotChunk.value)).toContain('"type":"snapshot"');
    expect(decodeChunk(snapshotChunk.value)).toContain('"entries":[]');

    appendMqttLog({
      level: 'success',
      direction: 'inbound',
      topic: 'solar_assistant/inverter_1/work_mode_priority/state',
      payload: 'Battery first',
    });

    await vi.advanceTimersByTimeAsync(1000);
    const entryChunk = await reader.read();
    const entryPayload = decodeChunk(entryChunk.value);
    expect(entryPayload).toContain('"type":"entry"');
    expect(entryPayload).toContain('"payload":"Battery first"');

    controller.abort();
    const done = await reader.read();
    expect(done.done).toBe(true);
  });
});
