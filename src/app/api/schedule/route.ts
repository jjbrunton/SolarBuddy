import { NextResponse } from 'next/server';
import { getRecentPlanData as getStoredRecentPlanData } from '@/lib/db/schedule-repository';
import { runScheduleCycle } from '@/lib/scheduler/cron';
// Route through the watchdog's resolver so the UI "current action" badge
// stays in sync with what the watchdog is actually about to do. Computing it
// independently from plan_slots caused the UI to ignore manual overrides,
// scheduled actions, target-SOC holds, and solar-surplus holds.
import { getResolvedSlotAction } from '@/lib/scheduler/watchdog';
import { getVirtualNow, getVirtualScheduleData, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

function getRecentPlanData() {
  if (isVirtualModeEnabled()) {
    return getVirtualScheduleData(getVirtualNow());
  }

  return getStoredRecentPlanData();
}

function getCurrentAction() {
  const now = isVirtualModeEnabled() ? getVirtualNow() : new Date();
  return getResolvedSlotAction(now);
}

export async function GET() {
  const { schedules, plan_slots } = getRecentPlanData();
  const current_action = getCurrentAction();
  return NextResponse.json(
    { schedules, plan_slots, current_action },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
}

export async function POST() {
  const result = await runScheduleCycle();
  const { schedules, plan_slots } = getRecentPlanData();
  const current_action = getCurrentAction();

  const statusCode = result.status === 'missing_config'
    ? 400
    : result.ok
      ? 200
      : 500;

  return NextResponse.json(
    { ...result, schedules, plan_slots, current_action },
    { status: statusCode },
  );
}
