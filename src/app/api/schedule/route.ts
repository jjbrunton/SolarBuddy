import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runScheduleCycle } from '@/lib/scheduler/cron';

export async function GET() {
  const db = getDb();
  const schedules = db
    .prepare("SELECT * FROM schedules WHERE date >= date('now', '-1 day') ORDER BY slot_start ASC")
    .all();
  return NextResponse.json({ schedules });
}

export async function POST() {
  try {
    await runScheduleCycle();
    const db = getDb();
    const schedules = db
      .prepare("SELECT * FROM schedules WHERE date >= date('now', '-1 day') ORDER BY slot_start ASC")
      .all();
    return NextResponse.json({ ok: true, schedules });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
