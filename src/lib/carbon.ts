import { getDb } from './db';

export interface CarbonReading {
  period_from: string;
  period_to: string;
  intensity_forecast: number | null;
  intensity_actual: number | null;
  intensity_index: string | null;
}

const API_BASE = 'https://api.carbonintensity.org.uk';

export async function fetchCarbonIntensity(from: string, to: string): Promise<CarbonReading[]> {
  const url = `${API_BASE}/intensity/${from}/${to}`;
  console.log(`[Carbon] Fetching intensity from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Carbon Intensity API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const data = json.data || [];

  return data.map((entry: Record<string, unknown>) => {
    const intensity = entry.intensity as Record<string, unknown> | undefined;
    return {
      period_from: entry.from as string,
      period_to: entry.to as string,
      intensity_forecast: intensity?.forecast as number | null,
      intensity_actual: intensity?.actual as number | null,
      intensity_index: intensity?.index as string | null,
    };
  });
}

export function storeCarbonIntensity(readings: CarbonReading[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO carbon_intensity (period_from, period_to, intensity_forecast, intensity_actual, intensity_index, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(period_from) DO UPDATE SET
      intensity_forecast = excluded.intensity_forecast,
      intensity_actual = excluded.intensity_actual,
      intensity_index = excluded.intensity_index,
      fetched_at = excluded.fetched_at
  `);
  const now = new Date().toISOString();
  const transaction = db.transaction((items: CarbonReading[]) => {
    for (const r of items) {
      upsert.run(r.period_from, r.period_to, r.intensity_forecast, r.intensity_actual, r.intensity_index, now);
    }
  });
  transaction(readings);
  console.log(`[Carbon] Stored ${readings.length} intensity readings`);
}

export async function fetchAndStoreCarbonIntensity(from: string, to: string): Promise<CarbonReading[]> {
  const readings = await fetchCarbonIntensity(from, to);
  if (readings.length > 0) {
    storeCarbonIntensity(readings);
  }
  return readings;
}

export function getStoredCarbonIntensity(from?: string, to?: string): CarbonReading[] {
  const db = getDb();
  let query = 'SELECT period_from, period_to, intensity_forecast, intensity_actual, intensity_index FROM carbon_intensity';
  const conditions: string[] = [];
  const params: string[] = [];

  if (from) {
    conditions.push('period_from >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('period_to <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY period_from ASC';

  return db.prepare(query).all(...params) as CarbonReading[];
}

/** Check if cached data covers the given range and is recent enough. */
export function isCacheStale(from: string, to: string, maxAgeMinutes = 30): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT MAX(fetched_at) as latest FROM carbon_intensity WHERE period_from >= ? AND period_to <= ?',
  ).get(from, to) as { latest: string | null } | undefined;

  if (!row?.latest) return true;
  const ageMs = Date.now() - new Date(row.latest).getTime();
  return ageMs > maxAgeMinutes * 60_000;
}
