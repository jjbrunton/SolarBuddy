import { NextResponse } from 'next/server';
import { getSavingsData } from '@/lib/analytics-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '7d';

  return NextResponse.json({ period, ...getSavingsData(period) });
}
