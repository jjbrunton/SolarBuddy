import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runScheduleCycle } from '@/lib/scheduler/cron';
import { getVirtualNow, getVirtualScheduleData, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

const SCHEDULE_HISTORY_WINDOW_DAYS = 30;

function getRecentPlanData() {
  if (isVirtualModeEnabled()) {
    return getVirtualScheduleData(getVirtualNow());
  }

  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SCHEDULE_HISTORY_WINDOW_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const schedules = db
    .prepare('SELECT * FROM schedules WHERE slot_end >= ? ORDER BY slot_start ASC, created_at ASC')
    .all(cutoffIso);
  const plan_slots = db
    .prepare('SELECT * FROM plan_slots WHERE slot_end >= ? ORDER BY slot_start ASC, created_at ASC')
    .all(cutoffIso);

  return { schedules, plan_slots };
}

export async function GET() {
  const { schedules, plan_slots } = getRecentPlanData();
  return NextResponse.json({ schedules, plan_slots });
}

export async function POST() {
  const result = await runScheduleCycle();
  const { schedules, plan_slots } = getRecentPlanData();

  const statusCode = result.status === 'missing_config'
    ? 400
    : result.ok
      ? 200
      : 500;

  return NextResponse.json({ ...result, schedules, plan_slots }, { status: statusCode });
}
