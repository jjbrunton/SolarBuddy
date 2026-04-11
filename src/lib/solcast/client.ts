import { getDb } from '../db';

export interface PVForecastSlot {
  valid_from: string;
  valid_to: string;
  pv_estimate_w: number;
  pv_estimate10_w: number;
  pv_estimate90_w: number;
}

interface ForecastSolarWattHours {
  [isoTimestamp: string]: number;
}

interface ForecastSolarResponse {
  result: {
    watts: ForecastSolarWattHours;
    watt_hours_period: ForecastSolarWattHours;
    watt_hours: ForecastSolarWattHours;
    watt_hours_day: Record<string, number>;
  };
  message: { code: number; type: string; text: string };
}

const CACHE_FRESH_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_PURGE_MS = 48 * 60 * 60 * 1000; // 48 hours

interface CachedForecastRow {
  valid_from: string;
  valid_to: string;
  pv_estimate_w: number;
  pv_estimate10_w: number | null;
  pv_estimate90_w: number | null;
  fetched_at: string;
}

function readFreshForecastCache(): PVForecastSlot[] | null {
  const db = getDb();
  const latest = db
    .prepare('SELECT MAX(fetched_at) as latest FROM pv_forecasts')
    .get() as { latest: string | null } | undefined;

  if (!latest?.latest) return null;

  const ageMs = Date.now() - new Date(latest.latest).getTime();
  if (!Number.isFinite(ageMs) || ageMs >= CACHE_FRESH_MS) return null;

  const rows = db
    .prepare(
      'SELECT valid_from, valid_to, pv_estimate_w, pv_estimate10_w, pv_estimate90_w, fetched_at FROM pv_forecasts ORDER BY valid_from ASC',
    )
    .all() as CachedForecastRow[];

  if (rows.length === 0) return null;

  return rows.map((r) => ({
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    pv_estimate_w: r.pv_estimate_w,
    pv_estimate10_w: r.pv_estimate10_w ?? Math.round(r.pv_estimate_w * 0.8),
    pv_estimate90_w: r.pv_estimate90_w ?? Math.round(r.pv_estimate_w * 1.2),
  }));
}

function writeForecastCache(forecasts: PVForecastSlot[]) {
  if (forecasts.length === 0) return;
  const db = getDb();

  // See storePVForecast for rationale: forecast.solar slot boundaries drift
  // a few minutes between fetches, so a keyed upsert leaves stale
  // overlapping rows behind. Delete any row whose window overlaps the new
  // forecast's window before inserting the fresh rows.
  let minValidFrom = forecasts[0].valid_from;
  let maxValidTo = forecasts[0].valid_to;
  for (const slot of forecasts) {
    if (slot.valid_from < minValidFrom) minValidFrom = slot.valid_from;
    if (slot.valid_to > maxValidTo) maxValidTo = slot.valid_to;
  }

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

  // Opportunistic cleanup of stale rows to prevent table bloat.
  const purgeBefore = new Date(Date.now() - CACHE_PURGE_MS).toISOString();
  db.prepare('DELETE FROM pv_forecasts WHERE fetched_at < ?').run(purgeBefore);
}

/**
 * Fetch PV forecast from api.forecast.solar (free, no auth required).
 * Returns hourly watt estimates converted to half-hour slots.
 *
 * Cache-first (default): if the DB has PV forecast rows fresher than 4 hours,
 * they're returned directly without hitting the API. Otherwise a fresh request
 * is made and the result is persisted to the cache. Pass `force=true` to
 * bypass the cache and always re-fetch — required after a config change
 * (e.g. pv_kwp correction) so the stale rows get overwritten with new values.
 *
 * API: GET https://api.forecast.solar/estimate/{lat}/{lon}/{dec}/{az}/{kwp}
 * - lat/lon: location
 * - dec: panel declination (tilt) in degrees
 * - az: panel azimuth (-180..180, 0=south)
 * - kwp: installed capacity in kWp
 */
export async function fetchPVForecast(
  latitude: string,
  longitude: string,
  declination: string,
  azimuth: string,
  kwp: string,
  force = false,
): Promise<PVForecastSlot[]> {
  if (!force) {
    const cached = readFreshForecastCache();
    if (cached) {
      console.log(`[PVForecast] Using cached forecast (${cached.length} slots)`);
      return cached;
    }
  } else {
    console.log('[PVForecast] Forced refresh — bypassing internal cache');
  }

  const url = `https://api.forecast.solar/estimate/${latitude}/${longitude}/${declination}/${azimuth}/${kwp}`;

  console.log(`[PVForecast] Fetching from: ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Forecast.Solar API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ForecastSolarResponse;

  if (!data.result?.watts) {
    return [];
  }

  // The API returns instantaneous watt values at hourly timestamps.
  // We interpolate to 30-min slots to match the Octopus rate grid.
  const entries = Object.entries(data.result.watts)
    .map(([ts, watts]) => ({ time: new Date(ts), watts }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  if (entries.length === 0) return [];

  const slots: PVForecastSlot[] = [];
  const SLOT_MS = 30 * 60 * 1000;

  // Generate 30-min slots across the forecast range
  const start = entries[0].time.getTime();
  const end = entries[entries.length - 1].time.getTime();

  for (let cursor = start; cursor < end; cursor += SLOT_MS) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + SLOT_MS);
    const slotMid = cursor + SLOT_MS / 2;

    // Interpolate: find the two surrounding data points
    let watts = 0;
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
      if (slotMid >= a.time.getTime() && slotMid <= b.time.getTime()) {
        const t = (slotMid - a.time.getTime()) / (b.time.getTime() - a.time.getTime());
        watts = a.watts + t * (b.watts - a.watts);
        break;
      }
    }

    // forecast.solar doesn't provide P10/P90 — use 80% and 120% as estimates
    slots.push({
      valid_from: slotStart.toISOString(),
      valid_to: slotEnd.toISOString(),
      pv_estimate_w: Math.round(watts),
      pv_estimate10_w: Math.round(watts * 0.8),
      pv_estimate90_w: Math.round(watts * 1.2),
    });
  }

  writeForecastCache(slots);
  return slots;
}
