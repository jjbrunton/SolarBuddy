import { defineConfig, devices } from '@playwright/test';

const port = 3201;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    storageState: './e2e/.auth-state.json',
    // `retain-on-failure` records every test and keeps only the failures — on
    // CI this is the difference between "something broke" and an actionable
    // post-mortem, at a small runtime cost.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // Next.js standalone mode writes server.js but does not copy .next/static
    // or public/ into the standalone tree. Client JS/CSS bundles (and public
    // assets) must be copied in before the server can serve them — without
    // this, any UI test that relies on client-side hydration (e.g. forms
    // backed by `useEffect`/`fetch`) hangs forever on skeleton content.
    command: [
      'mkdir -p .tmp .next/standalone/.next',
      'rm -rf .next/standalone/.next/static .next/standalone/public .tmp/playwright.db e2e/.auth-state.json',
      'cp -R .next/static .next/standalone/.next/static',
      '[ -d public ] && cp -R public .next/standalone/public || true',
      `PORT=${port} HOSTNAME=127.0.0.1 DB_PATH=.tmp/playwright.db SOLARBUDDY_AUTH_COOKIE_SECURE=0 node .next/standalone/server.js`,
    ].join(' && '),
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
