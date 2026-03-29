import { NextResponse } from 'next/server';
import { getCarbonData } from '@/lib/analytics-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || 'today';

  const data = await getCarbonData(period);
  return NextResponse.json({ period, ...data });
}
