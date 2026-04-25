import { NextResponse } from 'next/server';
import { buildSystemExport } from '@/lib/system-export';

export async function GET() {
  const payload = buildSystemExport();
  const filename = `solarbuddy-export-${payload.meta.exported_at.replace(/[:.]/g, '-')}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
