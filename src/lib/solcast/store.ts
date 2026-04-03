import { getDb } from '../db';
import type { PVForecastSlot } from './client';

export function storePVForecast(forecasts: PVForecastSlot[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO pv_forecasts (valid_from, valid_to, pv_estimate_w, pv_estimate10_w, pv_estimate90_w, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(valid_from) DO UPDATE SET
      pv_estimate_w = excluded.pv_estimate_w,
      pv_estimate10_w = excluded.pv_estimate10_w,
      pv_estimate90_w = excluded.pv_estimate90_w,
      fetched_at = excluded.fetched_at
  `);
  const now = new Date().toISOString();
  const transaction = db.transaction((slots: PVForecastSlot[]) => {
    for (const slot of slots) {
      upsert.run(
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
  console.log(`[Solcast] Stored ${forecasts.length} PV forecast slots`);
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
