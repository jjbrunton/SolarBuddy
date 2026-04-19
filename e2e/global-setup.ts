import { request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Playwright's webServer boots against a fresh DB, so the auth proxy will
// redirect every page and 409 every API call until an admin account exists.
// Bootstrap that account once and persist the session cookie into a storage
// state file that every test fixture loads via playwright.config.ts.
export default async function globalSetup(): Promise<void> {
  const port = process.env.PORT ?? '3201';
  const baseURL = `http://127.0.0.1:${port}`;
  const storageStatePath = path.join(__dirname, '.auth-state.json');

  const ctx = await request.newContext({ baseURL });

  // If a previous run persisted a valid session, keep it. Otherwise create
  // the single admin account — rerunnable because the route rejects duplicate
  // setup attempts and we tolerate that as "already good".
  const setup = await ctx.post('/api/auth/setup', {
    data: { username: 'e2e', password: 'e2e-e2e-e2e' },
    failOnStatusCode: false,
  });

  if (!setup.ok() && setup.status() !== 400) {
    throw new Error(`auth setup failed with status ${setup.status()}`);
  }

  // If setup was rejected because credentials already exist, fall back to
  // logging in with the same credentials so the storage state reflects a
  // valid session.
  if (setup.status() === 400) {
    const login = await ctx.post('/api/auth/login', {
      data: { username: 'e2e', password: 'e2e-e2e-e2e' },
    });
    if (!login.ok()) {
      throw new Error(`auth login failed with status ${login.status()}`);
    }
  }

  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
  await ctx.storageState({ path: storageStatePath });
  await ctx.dispose();
}
