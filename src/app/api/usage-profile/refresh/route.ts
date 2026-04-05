import { NextResponse } from 'next/server';
import {
  computeUsageProfile,
  getBaseloadW,
  getUsageHighPeriods,
  getUsageProfile,
} from '@/lib/usage';

export async function POST() {
  try {
    const result = await computeUsageProfile();

    if (!result.ok) {
      return NextResponse.json(
        {
          status: 'skipped',
          reason: result.reason ?? 'unknown',
          stats: result.stats,
        },
        { status: 200 },
      );
    }

    const profile = getUsageProfile();
    return NextResponse.json({
      status: 'ok',
      stats: result.stats,
      meta: profile?.meta ?? null,
      buckets: profile?.buckets ?? [],
      high_periods: getUsageHighPeriods(),
      baseload_w: getBaseloadW(),
    });
  } catch (err) {
    console.error('[API] /api/usage-profile/refresh failed:', err);
    return NextResponse.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
