import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pv_forecasts (
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      pv_estimate_w REAL NOT NULL,
      pv_estimate10_w REAL,
      pv_estimate90_w REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (valid_from)
    );
  `);
  return { testDb: db };
});

vi.mock('../../db', () => ({
  getDb: () => testDb,
}));

import { getLatestForecastAge, getStoredPVForecast, storePVForecast } from '../store';

function makeSlot(
  validFrom: string,
  validTo: string,
  watts: number,
): Parameters<typeof storePVForecast>[0][number] {
  return {
    valid_from: validFrom,
    valid_to: validTo,
    pv_estimate_w: watts,
    pv_estimate10_w: Math.round(watts * 0.8),
    pv_estimate90_w: Math.round(watts * 1.2),
  };
}

describe('pv forecast store', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM pv_forecasts').run();
  });

  it('stores and retrieves forecast slots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:00:00Z'));

    storePVForecast([
      makeSlot('2026-04-03T10:00:00.000Z', '2026-04-03T10:30:00.000Z', 100),
      makeSlot('2026-04-03T10:30:00.000Z', '2026-04-03T11:00:00.000Z', 200),
    ]);

    const rows = getStoredPVForecast();
    expect(rows).toHaveLength(2);
    expect(rows[0].pv_estimate_w).toBe(100);
    expect(rows[1].pv_estimate_w).toBe(200);

    vi.useRealTimers();
  });

  it('replaces overlapping rows from previous fetches with drifted slot boundaries', () => {
    // Simulate a stale fetch with a bad `pv_kwp` value. forecast.solar
    // returns slots at drifted minute offsets (e.g. 17:44, 47:44), so a
    // naive ON CONFLICT(valid_from) upsert would leave these rows behind
    // when a new, correctly-configured fetch returns slots at different
    // offsets (e.g. 19:53, 49:53). This is exactly the bug that causes
    // wild Est. PV numbers to linger after a pv_kwp correction.
    storePVForecast([
      makeSlot('2026-04-11T11:17:44.000Z', '2026-04-11T11:47:44.000Z', 150_000), // wrong
      makeSlot('2026-04-11T11:47:44.000Z', '2026-04-11T12:17:44.000Z', 160_000), // wrong
      makeSlot('2026-04-11T12:17:44.000Z', '2026-04-11T12:47:44.000Z', 150_000), // wrong
    ]);

    // Fresh fetch with correct kwp, different minute offsets.
    storePVForecast([
      makeSlot('2026-04-11T11:19:53.000Z', '2026-04-11T11:49:53.000Z', 900),
      makeSlot('2026-04-11T11:49:53.000Z', '2026-04-11T12:19:53.000Z', 950),
      makeSlot('2026-04-11T12:19:53.000Z', '2026-04-11T12:49:53.000Z', 920),
    ]);

    const rows = getStoredPVForecast();
    // Only the fresh rows must remain — the drifted stale rows must have
    // been deleted since their windows overlap the new forecast's window.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.pv_estimate_w < 1000)).toBe(true);
    expect(rows.map((r) => r.valid_from)).toEqual([
      '2026-04-11T11:19:53.000Z',
      '2026-04-11T11:49:53.000Z',
      '2026-04-11T12:19:53.000Z',
    ]);
  });

  it('preserves non-overlapping rows from past forecast windows', () => {
    // A row for a time window entirely before the new forecast must not
    // be deleted. This protects historical data the Schedule view may
    // still be displaying for today's earlier slots.
    storePVForecast([
      makeSlot('2026-04-11T06:00:00.000Z', '2026-04-11T06:30:00.000Z', 300),
    ]);

    storePVForecast([
      makeSlot('2026-04-11T10:00:00.000Z', '2026-04-11T10:30:00.000Z', 800),
      makeSlot('2026-04-11T10:30:00.000Z', '2026-04-11T11:00:00.000Z', 850),
    ]);

    const rows = getStoredPVForecast();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.pv_estimate_w)).toEqual([300, 800, 850]);
  });

  it('ignores empty forecast arrays without clearing existing rows', () => {
    storePVForecast([
      makeSlot('2026-04-11T10:00:00.000Z', '2026-04-11T10:30:00.000Z', 500),
    ]);

    storePVForecast([]);

    expect(getStoredPVForecast()).toHaveLength(1);
  });

  it('queries stored forecast slots with optional ranges', () => {
    storePVForecast([
      makeSlot('2026-04-11T06:00:00.000Z', '2026-04-11T06:30:00.000Z', 100),
      makeSlot('2026-04-11T10:00:00.000Z', '2026-04-11T10:30:00.000Z', 800),
    ]);

    const filtered = getStoredPVForecast(
      '2026-04-11T09:00:00.000Z',
      '2026-04-11T11:00:00.000Z',
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].pv_estimate_w).toBe(800);
  });

  it('returns Infinity when no forecast has been stored', () => {
    expect(getLatestForecastAge()).toBe(Infinity);
  });

  it('returns the age in minutes for the latest forecast', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:00:00Z'));

    storePVForecast([
      makeSlot('2026-04-03T10:00:00.000Z', '2026-04-03T10:30:00.000Z', 100),
    ]);

    vi.setSystemTime(new Date('2026-04-03T10:30:00Z'));
    expect(getLatestForecastAge()).toBe(30);

    vi.useRealTimers();
  });
});
