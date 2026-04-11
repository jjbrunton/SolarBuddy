import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Build metadata is baked in at build time via next.config.ts `env`.
// Exposed from the health endpoint so we can verify (from the outside)
// which commit a running instance is actually serving — essential when
// diagnosing deployments that auto-pull but don't rebuild.
function getBuildInfo() {
  const commit = process.env.BUILD_COMMIT || 'unknown';
  return {
    commit,
    commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    builtAt: process.env.BUILD_TIME || 'unknown',
  };
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const build = getBuildInfo();

  try {
    getDb().prepare('SELECT 1').get();

    return NextResponse.json(
      {
        ok: true,
        service: 'solarbuddy',
        timestamp,
        build,
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
        build,
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

