import { NextResponse } from 'next/server';
import { getBatteryData } from '@/lib/analytics-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '30d';

  return NextResponse.json({ period, ...getBatteryData(period) });
}
