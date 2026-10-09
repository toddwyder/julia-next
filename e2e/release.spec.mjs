import { test, expect } from '@playwright/test';
test('production serves the merged commit without browser errors', async ({ page, request }) => {
  test.skip(!process.env.JULIA_SMOKE_COMMIT, 'release-only deployment identity check');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: 'ok', commit: process.env.JULIA_SMOKE_COMMIT });
  await page.goto('/');
  await expect(page.getByText('what are we cooking today?')).toBeVisible();
  expect(errors).toEqual([]);
});
