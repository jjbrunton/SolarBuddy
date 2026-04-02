import { NextResponse } from 'next/server';
import { getEventsLog } from '@/lib/events';

export async function GET() {
  return NextResponse.json({ events: getEventsLog() });
}
