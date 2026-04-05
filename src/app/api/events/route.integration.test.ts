import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { INITIAL_STATE, replaceState, updateState } from '@/lib/state';

function decodeChunk(value?: Uint8Array) {
  return new TextDecoder().decode(value);
}

function parseSseData(chunk: string) {
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error(`Expected SSE data line, got: ${chunk}`);
  }
  return JSON.parse(dataLine.slice(6));
}

describe('/api/events state stream integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replaceState({
      ...INITIAL_STATE,
      mqtt_connected: false,
      battery_soc: 51,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams initial state, pushes updates, and sends keep-alive pings', async () => {
    const controller = new AbortController();
    const response = await GET(new Request('http://localhost/api/events', { signal: controller.signal }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');

    const reader = response.body!.getReader();

    const initialChunk = await reader.read();
    const initialState = parseSseData(decodeChunk(initialChunk.value));
    expect(initialState).toMatchObject({
      mqtt_connected: false,
      battery_soc: 51,
    });

    updateState({
      mqtt_connected: true,
      battery_soc: 64,
      pv_power: 1200,
    });

    const updateChunk = await reader.read();
    const updatedState = parseSseData(decodeChunk(updateChunk.value));
    expect(updatedState).toMatchObject({
      mqtt_connected: true,
      battery_soc: 64,
      pv_power: 1200,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    const pingChunk = await reader.read();
    expect(decodeChunk(pingChunk.value)).toContain(': ping');

    controller.abort();
    const done = await reader.read();
    expect(done.done).toBe(true);
  });
});
