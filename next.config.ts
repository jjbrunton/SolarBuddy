import { execSync } from 'child_process';
import type { NextConfig } from 'next';

// Resolve the git commit SHA and build timestamp at build time so the
// deployed /api/health endpoint can expose them. This lets us verify
// (from the outside) which commit a running instance is serving — useful
// when a deployment auto-pulls but doesn't rebuild and we're trying to
// figure out why a fix hasn't taken effect.
function resolveBuildCommit(): string {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const BUILD_COMMIT = resolveBuildCommit();
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'mqtt'],
  // Inline build metadata so the values are baked into the standalone
  // bundle. Server code reads them via process.env.BUILD_COMMIT / BUILD_TIME.
  env: {
    BUILD_COMMIT,
    BUILD_TIME,
  },
  async redirects() {
    return [
      { source: '/analytics/:path*', destination: '/savings', permanent: true },
      { source: '/inverter', destination: '/', permanent: true },
      { source: '/solar', destination: '/', permanent: true },
      { source: '/activity', destination: '/system', permanent: true },
      { source: '/settings/mqtt', destination: '/settings', permanent: true },
      { source: '/settings/octopus', destination: '/settings', permanent: true },
      { source: '/settings/charging', destination: '/settings', permanent: true },
      { source: '/settings/solar', destination: '/settings', permanent: true },
      { source: '/settings/scheduled-actions', destination: '/settings', permanent: true },
      { source: '/system/tasks', destination: '/system', permanent: true },
      { source: '/system/logs', destination: '/system', permanent: true },
    ];
  },
};

export default nextConfig;
