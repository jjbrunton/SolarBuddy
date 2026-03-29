import { NextResponse } from 'next/server';
import { getEnergyData } from '@/lib/analytics-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '7d';

  return NextResponse.json({ period, ...getEnergyData(period) });
}
