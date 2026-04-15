import { NextResponse } from 'next/server';
import { refreshNordpoolForecast } from '@/lib/nordpool/refresh';
import { replanFromStoredRates } from '@/lib/scheduler/cron';
import { errorResponse } from '@/lib/api-error';

export async function POST() {
  try {
    const result = await refreshNordpoolForecast();

    if (result.status === 'ok') {
      // Kick the planner so the new forecast rates flow into the live plan.
      replanFromStoredRates();
    }

    const httpStatus = result.status === 'error' ? 500 : 200;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    return errorResponse(err);
  }
}
