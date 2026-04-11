import { NextResponse } from 'next/server';
import { type PlanAction, PLAN_ACTIONS } from '@/lib/plan-actions';
import { reconcileInverterState } from '@/lib/scheduler/watchdog';
import {
  clearTodayOverrides,
  deleteTodayOverrideSlot,
  listTodayOverrides,
  replaceTodayOverrides,
  upsertTodayOverride,
} from '@/lib/db/override-repository';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET() {
  const overrides = listTodayOverrides();
  return NextResponse.json({ overrides });
}

export async function POST(request: Request) {
  const { slots } = (await request.json()) as {
    slots: { slot_start: string; slot_end: string; action?: PlanAction }[];
  };

  if (!Array.isArray(slots)) {
    return errorResponse(ApiError.badRequest('slots must be an array'));
  }

  const count = replaceTodayOverrides(slots);

  await reconcileInverterState('manual overrides replaced');

  return NextResponse.json({ ok: true, count });
}

/** Upsert a single slot override */
export async function PATCH(request: Request) {
  const { slot_start, slot_end, action } = (await request.json()) as {
    slot_start: string;
    slot_end: string;
    action: PlanAction;
  };

  if (!slot_start || !slot_end || !action || !PLAN_ACTIONS.includes(action)) {
    return errorResponse(ApiError.badRequest('slot_start, slot_end, and valid action required'));
  }

  upsertTodayOverride(slot_start, slot_end, action);

  await reconcileInverterState('manual override updated');

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  // Support deleting a single slot via query params
  const url = new URL(request.url);
  const slotStart = url.searchParams.get('slot_start');

  if (slotStart) {
    deleteTodayOverrideSlot(slotStart);
  } else {
    clearTodayOverrides();
  }

  await reconcileInverterState(slotStart ? 'manual override removed' : 'manual overrides cleared');

  return NextResponse.json({ ok: true });
}
