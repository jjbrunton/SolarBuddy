import { NextResponse } from 'next/server';
import { getBestSlots } from '@/lib/backtest/engine';
import { periodToISO } from '@/lib/analytics';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '30d';
    const limitRaw = parseInt(searchParams.get('limit') || '10', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

    const slots = getBestSlots({
      fromISO: periodToISO(period),
      toISO: new Date().toISOString(),
      limit,
    });

    return NextResponse.json(
      { period, slots },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error('[api/analytics/best-slots] error', err);
    return errorResponse(ApiError.serviceUnavailable('Best-slots lookup failed'));
  }
}
