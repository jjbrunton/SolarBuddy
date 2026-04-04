import { NextResponse } from 'next/server';
import { getRecentPlanData as getStoredRecentPlanData } from '@/lib/db/schedule-repository';
import { runScheduleCycle } from '@/lib/scheduler/cron';
import { getVirtualNow, getVirtualScheduleData, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

function getRecentPlanData() {
  if (isVirtualModeEnabled()) {
    return getVirtualScheduleData(getVirtualNow());
  }

  return getStoredRecentPlanData();
}
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
