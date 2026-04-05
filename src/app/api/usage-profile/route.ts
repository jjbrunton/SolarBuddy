import { NextResponse } from 'next/server';
import { getBaseloadW, getUsageHighPeriods, getUsageProfile } from '@/lib/usage';

export async function GET() {
  const profile = getUsageProfile();

  if (!profile || !profile.meta) {
    return NextResponse.json(
      {
        status: 'empty',
        reason: 'usage profile not yet computed',
      },
      { status: 200, headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  }

  return NextResponse.json(
    {
      status: 'ok',
      meta: profile.meta,
      buckets: profile.buckets,
      high_periods: getUsageHighPeriods(),
      baseload_w: getBaseloadW(),
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
