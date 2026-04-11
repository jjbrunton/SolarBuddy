import { getDb } from '../db';
import type { PVForecastSlot } from './client';

/**
 * Replace any PV forecast rows whose time window overlaps with the incoming
 * forecast, then insert the fresh rows.
 *
 * This is deliberately NOT a simple `ON CONFLICT(valid_from)` upsert:
 * forecast.solar returns half-hour slots at arbitrary minute offsets (e.g.
 * `12:17:44`, `12:47:44`) which drift a few minutes between fetches. Keyed
 * upserts never match those drifted rows, so over time the table
 * accumulates multiple overlapping copies — and a stale copy written when
 * configuration was wrong (e.g. a unit mistake on `pv_kwp`) would survive
 * every subsequent refresh and keep surfacing wrong numbers in the
 * Schedule view. Wiping the covered range first guarantees only the
 * latest fetch's values exist within that window.
 */
export function storePVForecast(forecasts: PVForecastSlot[]) {
  if (forecasts.length === 0) return;

  const db = getDb();

  // Determine the time window covered by the incoming forecast. The new
  // range is [minValidFrom, maxValidTo) — any existing row whose window
  // overlaps this range is considered superseded and deleted first.
  let minValidFrom = forecasts[0].valid_from;
  let maxValidTo = forecasts[0].valid_to;
  for (const slot of forecasts) {
    if (slot.valid_from < minValidFrom) minValidFrom = slot.valid_from;
    if (slot.valid_to > maxValidTo) maxValidTo = slot.valid_to;
  }

  // A row is considered superseded if its window [valid_from, valid_to)
  // overlaps the new window [minValidFrom, maxValidTo). Two intervals
  // overlap when `a.start < b.end AND a.end > b.start`.
  const deleteOverlapping = db.prepare(
    'DELETE FROM pv_forecasts WHERE valid_from < ? AND valid_to > ?',
  );
  const insert = db.prepare(`
    INSERT INTO pv_forecasts (valid_from, valid_to, pv_estimate_w, pv_estimate10_w, pv_estimate90_w, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(valid_from) DO UPDATE SET
      valid_to = excluded.valid_to,
      pv_estimate_w = excluded.pv_estimate_w,
      pv_estimate10_w = excluded.pv_estimate10_w,
      pv_estimate90_w = excluded.pv_estimate90_w,
      fetched_at = excluded.fetched_at
  `);

  const now = new Date().toISOString();
  const transaction = db.transaction((slots: PVForecastSlot[]) => {
    deleteOverlapping.run(maxValidTo, minValidFrom);
    for (const slot of slots) {
      insert.run(
        slot.valid_from,
        slot.valid_to,
        slot.pv_estimate_w,
        slot.pv_estimate10_w,
        slot.pv_estimate90_w,
        now,
      );
    }
  });
  transaction(forecasts);
  console.log(`[Solcast] Stored ${forecasts.length} PV forecast slots (window ${minValidFrom} → ${maxValidTo})`);
}

export function getStoredPVForecast(from?: string, to?: string): PVForecastSlot[] {
  const db = getDb();
  let query = 'SELECT valid_from, valid_to, pv_estimate_w, pv_estimate10_w, pv_estimate90_w FROM pv_forecasts';
  const conditions: string[] = [];
  const params: string[] = [];

  if (from) {
    conditions.push('valid_from >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('valid_to <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY valid_from ASC';

  return db.prepare(query).all(...params) as PVForecastSlot[];
}

/** Returns minutes since the last successful forecast fetch, or Infinity if none. */
export function getLatestForecastAge(): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT MAX(fetched_at) as latest FROM pv_forecasts',
  ).get() as { latest: string | null } | undefined;

  if (!row?.latest) return Infinity;

  const fetched = new Date(row.latest).getTime();
  return (Date.now() - fetched) / (60 * 1000);
}
