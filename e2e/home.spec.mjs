import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('home page shows Julia, the application version, and a welcome line', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toContainText('Julia');
  await expect(page.locator('main')).toContainText(version);
  await expect(page.locator('main > p')).toHaveText('what are we cooking today?');
  await expect(page.locator('main > p')).toBeVisible();
  await expect(page.locator('main > div')).toHaveText(`Julia ${version}`);
  await expect(page.locator('main > *')).toHaveText([
    `Julia ${version}`,
    'what are we cooking today?',
  ]);
});
