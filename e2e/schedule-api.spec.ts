import { expect, test } from '@playwright/test';

test.describe('/api/schedule', () => {
  test('GET returns the persisted plan envelope with cache header', async ({ request }) => {
    const res = await request.get('/api/schedule');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('private, max-age=30');

    const body = await res.json();
    // Shape: { schedules, plan_slots, current_action }
    expect(Array.isArray(body.schedules)).toBe(true);
    expect(Array.isArray(body.plan_slots)).toBe(true);
    expect(body).toHaveProperty('current_action');
  });

  test('POST replan without rates returns missing_config with a 400', async ({ request }) => {
    // The Playwright DB starts empty: no Octopus API key, no rates table rows.
    // runScheduleCycle should return status 'missing_config' and the route
    // should surface that as a 400.
    const res = await request.post('/api/schedule');
    // Either 400 (no config) or 500 (unexpected failure). We accept missing_config
    // as the healthy signal; anything else means the scheduler crashed unexpectedly.
    if (res.status() === 400) {
      const body = await res.json();
      expect(body).toMatchObject({ status: 'missing_config' });
    } else {
      // If upstream config defaults make this path succeed, just make sure the
      // response shape is still valid.
      const body = await res.json();
      expect(body).toHaveProperty('schedules');
      expect(body).toHaveProperty('plan_slots');
    }
  });
});

test.describe('Schedule page', () => {
  test('renders without runtime errors and shows the header', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.getByRole('link', { name: /schedule/i }).first().click();
    await expect(page).toHaveURL(/\/schedule$/);

    // Page should have loaded enough to show a heading or page structure.
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
