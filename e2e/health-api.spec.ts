import { expect, test } from '@playwright/test';

test.describe('/api/health', () => {
  test('returns ok=true with build metadata and a no-store cache header', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      service: 'solarbuddy',
      timestamp: expect.any(String),
      build: {
        commit: expect.any(String),
        commitShort: expect.any(String),
        builtAt: expect.any(String),
      },
    });

    // Commit-short is always 7 chars when commit is known; 'unknown' when not.
    if (payload.build.commit === 'unknown') {
      expect(payload.build.commitShort).toBe('unknown');
    } else {
      expect(payload.build.commitShort).toHaveLength(7);
      expect(payload.build.commit.startsWith(payload.build.commitShort)).toBe(true);
    }

    // Timestamps are parseable.
    expect(Number.isNaN(new Date(payload.timestamp).getTime())).toBe(false);
  });

  test('every currently-documented API GET route returns a non-5xx response', async ({ request }) => {
    // Smoke-style sweep: proves the build wired every route up and none crash
    // on a bare DB. 2xx is ideal; 4xx is acceptable (route requires config).
    // Anything ≥500 is a regression.
    //
    // /api/events is a Server-Sent Events stream — excluded from the sweep
    // because it stays open. /api/events-log is the polling counterpart we do
    // want to exercise.
    const routes = [
      '/api/health',
      '/api/status',
      '/api/settings',
      '/api/overrides',
      '/api/schedule',
      '/api/scheduled-actions',
      '/api/rates',
      '/api/forecast',
      '/api/readings',
      '/api/analytics/savings',
      '/api/analytics/attribution',
      '/api/events-log',
      '/api/system',
      '/api/usage-profile',
      '/api/virtual-inverter',
      '/api/home-assistant/status',
    ];

    const results = await Promise.all(
      routes.map(async (path) => ({
        path,
        status: (await request.get(path, { timeout: 10_000 })).status(),
      })),
    );

    for (const { path, status } of results) {
      expect(status, `${path} returned ${status}`).toBeLessThan(500);
    }
  });
});
