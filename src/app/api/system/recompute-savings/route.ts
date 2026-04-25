import { NextResponse } from 'next/server';
import { recomputeAttributionRange } from '@/lib/attribution';
import { recomputeSlotScoresForRange } from '@/lib/backtest/engine';
import { appendEvent } from '@/lib/events';
import { errorResponse, ApiError } from '@/lib/api-error';

// Manual full recompute trigger. Wipes nothing — both caches use upserts
// keyed by date / slot_start, so re-running just refreshes the rows in
// place. Bounded to 90 days to stay well below the readings retention
// window and keep one click cheap on a Pi.
const DAYS_BACK = 90;

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const daysParam = parseInt(url.searchParams.get('days') || `${DAYS_BACK}`, 10);
    const daysBack = Number.isFinite(daysParam) ? Math.max(1, Math.min(365, daysParam)) : DAYS_BACK;

    const startedAt = Date.now();
    const attribution = recomputeAttributionRange(daysBack);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fromISO = new Date(today.getTime() - daysBack * 86400000).toISOString();
    const toISO = today.toISOString();
    const slots = recomputeSlotScoresForRange({ fromISO, toISO });

    const elapsedMs = Date.now() - startedAt;
    const message = `Savings recompute complete: ${attribution.days_recomputed} days, ${slots.slots_recomputed} slots in ${elapsedMs}ms.`;
    appendEvent({ level: 'info', category: 'savings-cache', message });

    return NextResponse.json({
      ok: true,
      message,
      days_recomputed: attribution.days_recomputed,
      slots_recomputed: slots.slots_recomputed,
      elapsed_ms: elapsedMs,
    });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error('[api/system/recompute-savings] error', err);
    return errorResponse(ApiError.serviceUnavailable('Savings recompute failed'));
  }
}
