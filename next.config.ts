import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'mqtt'],
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
