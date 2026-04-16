import { expect, test } from '@playwright/test';

test.describe('/api/simulate', () => {
  test('rejects with 400 when no rates are stored', async ({ request }) => {
    // Fresh Playwright DB has no Octopus API key + no rates rows → simulator
    // can't run. We want the route to return a clean 400 with an "error" field
    // rather than a 500, because the UI surfaces the error text directly.
    const res = await request.post('/api/simulate', {
      data: { start_soc: 50 },
    });

    // Either 400 (expected for empty DB) or 200 (tariff defaults happened to
    // produce synthetic rates). Anything else = regression.
    expect([200, 400]).toContain(res.status());
    const body = await res.json();
    if (res.status() === 400) {
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/rates/i);
    } else {
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.slots)).toBe(true);
      expect(body).toHaveProperty('summary');
    }
  });
});

test.describe('Simulate page', () => {
  test('renders and the Run button is present and clickable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/simulate');
    await expect(page.getByRole('heading', { name: 'Simulation', exact: true })).toBeVisible();

    const runButton = page.getByRole('button', { name: /run simulation/i }).first();
    await expect(runButton).toBeVisible();
    await expect(runButton).toBeEnabled();

    expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
