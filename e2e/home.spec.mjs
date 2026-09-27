import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('home page shows Julia and the application version', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toContainText('Julia');
  await expect(page.locator('main')).toContainText(version);
});
