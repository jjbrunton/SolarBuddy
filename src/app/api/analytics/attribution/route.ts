import { NextResponse } from 'next/server';
import { getAttributionData } from '@/lib/attribution';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '7d';

  return NextResponse.json(
    { period, ...getAttributionData(period) },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
