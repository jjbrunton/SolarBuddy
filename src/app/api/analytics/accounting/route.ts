import { NextResponse } from 'next/server';
import { getDailyPnL } from '@/lib/accounting';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '7d';

  return NextResponse.json({ period, ...getDailyPnL(period) });
}
