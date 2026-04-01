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
  const result = await runScheduleCycle();
  const db = getDb();
  const schedules = db
    .prepare("SELECT * FROM schedules WHERE date >= date('now', '-1 day') ORDER BY slot_start ASC")
    .all();

  const statusCode = result.status === 'missing_config'
    ? 400
    : result.ok
      ? 200
      : 500;

  return NextResponse.json({ ...result, schedules }, { status: statusCode });
}
