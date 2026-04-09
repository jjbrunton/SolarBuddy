import { NextResponse } from 'next/server';
import { getEstimatedBill } from '@/lib/bill-estimate';

export async function GET() {
  return NextResponse.json(
    getEstimatedBill(),
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
