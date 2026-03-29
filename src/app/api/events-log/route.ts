import { NextResponse } from 'next/server';
import { getEventsLog } from '@/lib/analytics-data';

export async function GET() {
  return NextResponse.json({ events: getEventsLog() });
}
