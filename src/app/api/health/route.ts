import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    getDb().prepare('SELECT 1').get();

    return NextResponse.json(
      {
        ok: true,
        service: 'solarbuddy',
        timestamp,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: 'solarbuddy',
        timestamp,
        error: 'Database unavailable',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}

