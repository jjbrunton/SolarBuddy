import { NextResponse } from 'next/server';
import { syncInverterTime } from '@/lib/inverter/time-sync';

export async function POST() {
  const result = await syncInverterTime();
  return NextResponse.json(result);
}
