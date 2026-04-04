import { NextResponse } from 'next/server';
import { getRecentPlanData } from '@/lib/db/schedule-repository';
import { runScheduleCycle } from '@/lib/scheduler/cron';

export async function GET() {
  const { schedules, plan_slots } = getRecentPlanData();
  return NextResponse.json(
    { schedules, plan_slots },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
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
