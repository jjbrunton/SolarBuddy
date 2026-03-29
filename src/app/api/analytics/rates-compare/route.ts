import { NextResponse } from 'next/server';
import { getRatesCompareData } from '@/lib/analytics-data';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const compare = searchParams.get('compare') || '7d';

  return NextResponse.json({ compare_period: compare, ...getRatesCompareData(compare) });
}
