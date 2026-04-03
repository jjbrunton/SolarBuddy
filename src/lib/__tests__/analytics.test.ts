import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { periodToISO, wattSamplesToKwh } from '../analytics';

describe('periodToISO', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:34:56Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the UTC start of today for the today period', () => {
    expect(periodToISO('today')).toBe('2026-04-03T00:00:00.000Z');
  });

  it('supports hour-based windows', () => {
    expect(periodToISO('48h')).toBe('2026-04-01T12:34:56.000Z');
  });

  it('supports day-based windows', () => {
    expect(periodToISO('30d')).toBe('2026-03-04T12:34:56.000Z');
  });

  it('falls back to the last 7 days for invalid periods', () => {
    expect(periodToISO('invalid')).toBe('2026-03-27T12:34:56.000Z');
  });
});

describe('wattSamplesToKwh', () => {
  it('returns zero when there are no samples', () => {
    expect(wattSamplesToKwh(5000, 0)).toBe(0);
  });

  it('converts a day of watt samples into kWh', () => {
    expect(wattSamplesToKwh(48000, 48)).toBe(24);
  });

  it('respects a custom total span and rounds to 2 decimals', () => {
    expect(wattSamplesToKwh(12345, 7, 3600)).toBe(1.76);
  });
});
