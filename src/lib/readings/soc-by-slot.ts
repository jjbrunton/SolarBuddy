import { getDb } from '@/lib/db';

export interface SlotSOC {
  slot_start: string;
  battery_soc: number;
}

/**
 * Return the average battery SOC for each half-hour slot on the given date.
 * Uses the same 30-minute bucketing pattern as analytics-data.ts.
 */
export function getActualSOCBySlot(date: string): SlotSOC[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:', timestamp) ||
        CASE WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '00' ELSE '30' END ||
        ':00.000Z' as slot_start,
      ROUND(AVG(battery_soc), 1) as battery_soc
    FROM readings
    WHERE timestamp >= ? AND timestamp < ?
      AND battery_soc IS NOT NULL
    GROUP BY slot_start
    ORDER BY slot_start ASC
  `).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as SlotSOC[];

  return rows;
}
