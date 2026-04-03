import { expect, test } from '@playwright/test';

test('health endpoint responds successfully', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();

  expect(await response.json()).toEqual({
    ok: true,
    service: 'solarbuddy',
    timestamp: expect.any(String),
  });
});

test('core pages render and navigation links work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'System dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Simulation' }).click();
  await expect(page).toHaveURL(/\/simulate$/);
  await expect(page.getByRole('heading', { name: 'Simulation', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'General' })).toBeVisible();

  await page.getByRole('link', { name: 'System' }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole('heading', { name: 'System' })).toBeVisible();
  await expect(page.getByText('Core infrastructure checks for the broker, rates, and scheduler services.')).toBeVisible();
});
