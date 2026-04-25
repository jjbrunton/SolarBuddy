import { NextResponse } from 'next/server';
import { getSchedulingEfficacy } from '@/lib/backtest/engine';
import { periodToISO } from '@/lib/analytics';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '30d';

    const efficacy = getSchedulingEfficacy({
      fromISO: periodToISO(period),
      toISO: new Date().toISOString(),
    });

    return NextResponse.json(
      { period, ...efficacy },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error('[api/analytics/scheduling-efficacy] error', err);
    return errorResponse(ApiError.serviceUnavailable('Scheduling-efficacy lookup failed'));
  }
}
