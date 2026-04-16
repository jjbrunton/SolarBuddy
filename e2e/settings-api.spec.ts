import { expect, test } from '@playwright/test';

test.describe('/api/settings round-trip', () => {
  test('POST persists settings visible to a subsequent GET', async ({ request }) => {
    const original = await (await request.get('/api/settings')).json();

    // Use a schedule-irrelevant key so we don't perturb the planner.
    const probeValue = original.notifications_state_change === 'true' ? 'false' : 'true';

    const post = await request.post('/api/settings', {
      data: { notifications_state_change: probeValue },
    });
    expect(post.ok()).toBe(true);

    const after = await (await request.get('/api/settings')).json();
    expect(after.notifications_state_change).toBe(probeValue);

    // Restore so we don't leave state behind for the next test.
    await request.post('/api/settings', {
      data: { notifications_state_change: original.notifications_state_change },
    });
  });

  test('unknown setting keys are silently dropped; non-string values return 400', async ({ request }) => {
    const before = await (await request.get('/api/settings')).json();

    const res = await request.post('/api/settings', {
      data: { made_up_setting_key: 'oops', notifications_state_change: before.notifications_state_change },
    });
    expect(res.ok()).toBe(true);

    const after = await (await request.get('/api/settings')).json();
    expect(Object.prototype.hasOwnProperty.call(after, 'made_up_setting_key')).toBe(false);

    const bad = await request.post('/api/settings', {
      // number, not string — route should reject.
      data: { charge_rate: 80 },
    });
    expect(bad.status()).toBe(400);
  });
});

test.describe('Settings UI', () => {
  test('saving a setting in the General tab persists across reload', async ({ page, request }) => {
    // Toggle the Default Work Mode select because it's the first control on
    // the General tab (the default landing tab) and has a small, stable set
    // of option values.
    const original = await (await request.get('/api/settings')).json();
    const originalMode = original.default_work_mode;
    const nextMode = originalMode === 'Battery first' ? 'Load first' : 'Battery first';

    // Wait for the settings fetch to complete before the page load finishes.
    const settingsFetch = page.waitForResponse(
      (res) => res.url().endsWith('/api/settings') && res.status() === 200,
    );
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await settingsFetch;

    const workModeSelect = page.locator('select').first();
    await expect(workModeSelect).toBeVisible({ timeout: 10_000 });
    await expect(workModeSelect).toHaveValue(originalMode);
    await workModeSelect.selectOption(nextMode);

    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByText(/saved successfully/i)).toBeVisible();

    // Confirm via the API (what the server actually persisted).
    const after = await (await request.get('/api/settings')).json();
    expect(after.default_work_mode).toBe(nextMode);

    // Reload and confirm the UI reflects the persisted state.
    const reloadFetch = page.waitForResponse(
      (res) => res.url().endsWith('/api/settings') && res.status() === 200,
    );
    await page.reload();
    await reloadFetch;
    const reloadedSelect = page.locator('select').first();
    await expect(reloadedSelect).toBeVisible();
    await expect(reloadedSelect).toHaveValue(nextMode);

    // Restore so other tests see the original value.
    await request.post('/api/settings', { data: { default_work_mode: originalMode } });
  });
});
