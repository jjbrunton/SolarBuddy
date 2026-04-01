import { describe, expect, it } from 'vitest';
import { INITIAL_STATE } from '@/lib/types';
import {
  hasTelemetryData,
  mergeIncomingTelemetryState,
  parseCachedTelemetryPayload,
} from '../liveTelemetry';

describe('hasTelemetryData', () => {
  it('returns false for the initial empty state', () => {
    expect(hasTelemetryData(INITIAL_STATE)).toBe(false);
  });

  it('returns true when any telemetry field is present', () => {
    expect(
      hasTelemetryData({
        ...INITIAL_STATE,
        battery_soc: 72,
      })
    ).toBe(true);
  });
});

describe('mergeIncomingTelemetryState', () => {
  it('uses incoming live telemetry when data is present', () => {
    const incoming = {
      ...INITIAL_STATE,
      mqtt_connected: true,
      battery_soc: 81,
    };

    expect(mergeIncomingTelemetryState(INITIAL_STATE, incoming)).toEqual({
      state: incoming,
      showingCachedTelemetry: false,
    });
  });

  it('keeps cached telemetry when the incoming state is empty', () => {
    const previous = {
      ...INITIAL_STATE,
      mqtt_connected: true,
      battery_soc: 64,
      work_mode: 'Battery first',
    };

    expect(mergeIncomingTelemetryState(previous, INITIAL_STATE)).toEqual({
      state: {
        ...previous,
        mqtt_connected: false,
      },
      showingCachedTelemetry: true,
    });
  });
});

describe('parseCachedTelemetryPayload', () => {
  it('parses a valid cached payload', () => {
    const payload = JSON.stringify({
      savedAt: '2026-03-30T10:00:00.000Z',
      state: {
        ...INITIAL_STATE,
        battery_soc: 55,
      },
    });

    expect(parseCachedTelemetryPayload(payload)).toEqual({
      savedAt: '2026-03-30T10:00:00.000Z',
      state: {
        ...INITIAL_STATE,
        battery_soc: 55,
      },
    });
  });

  it('returns null for invalid payloads', () => {
    expect(parseCachedTelemetryPayload('not-json')).toBeNull();
    expect(parseCachedTelemetryPayload(JSON.stringify({ nope: true }))).toBeNull();
  });
});
