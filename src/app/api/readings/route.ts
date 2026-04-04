import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getActualSOCBySlot } from '@/lib/readings/soc-by-slot';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'today';

  if (period === 'soc-slots') {
    const date = url.searchParams.get('date');
    if (!date) {
      return errorResponse(ApiError.badRequest('date parameter required'));
    }
    return NextResponse.json({ soc_slots: getActualSOCBySlot(date) });
  }

  const db = getDb();

  let readings: unknown[] = [];
  let daily: unknown[] = [];

  if (period === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    readings = db
      .prepare(
        `SELECT timestamp, battery_soc, pv_power, grid_power, load_power
         FROM readings
         WHERE timestamp >= ?
         ORDER BY timestamp ASC`
      )
      .all(todayStart.toISOString());

    // Daily summaries for last 7 days
    daily = db
      .prepare(
        `SELECT
           date(timestamp) as date,
           MAX(pv_power) as max_pv,
           COUNT(*) as readings_count
         FROM readings
         WHERE timestamp >= datetime('now', '-7 days')
         GROUP BY date(timestamp)
         ORDER BY date DESC`
      )
      .all();
  }

  return NextResponse.json(
    { readings, daily },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
