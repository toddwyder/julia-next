import { test, expect } from '@playwright/test';
import { listReady } from '../lib/linear.js';

if (process.env.DASHBOARD_URL) test('fresh real Ready list, Start and Back leave cards unchanged', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const before = await listReady();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ready cards', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Start / })).toHaveCount(before.length);
  for (const card of before) await expect(page.getByRole('heading', { name: card.title, exact: true })).toBeVisible();
  if (!before.length) await expect(page.getByText('No Ready cards.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ready.png'), fullPage: true });
  for (let i = 0; i < 2 && before.length; i++) {
    await page.getByRole('link', { name: `Start ${before[0].title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/start/${before[0].identifier}$`));
    await expect(page.getByRole('heading', { name: before[0].title, exact: true })).toBeVisible();
    await expect(page.getByText('This card is still Ready.', { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`start-${i}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Back to Ready cards' }).click();
    await expect(page.getByRole('link', { name: /^Start / })).toHaveCount(before.length);
  }
  expect((await listReady()).map(x => x.identifier)).toEqual(before.map(x => x.identifier));
  expect(errors).toEqual([]);
});

if (!process.env.DASHBOARD_URL) test('missing Linear configuration shows a named failure, not invented cards', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Linear configuration failure. LINEAR_API_KEY is missing.');
  await expect(page.getByRole('link', { name: /^Start / })).toHaveCount(0);
  const icon = await page.request.get('/favicon.ico');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toBe('image/x-icon');
  expect(errors).toEqual([]);
});
