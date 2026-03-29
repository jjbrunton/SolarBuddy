import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();

  // Ensure events table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
  `);

  const events = db
    .prepare(
      `SELECT id, timestamp, level, category, message
       FROM events
       ORDER BY timestamp DESC
       LIMIT 100`
    )
    .all();

  return NextResponse.json({ events });
}
