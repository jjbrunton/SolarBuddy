import { NextResponse } from 'next/server';
import { getEventsLog } from '@/lib/events';

export async function GET() {
  return NextResponse.json(
    { events: getEventsLog() },
    { headers: { 'Cache-Control': 'private, max-age=10' } },
  );
}
