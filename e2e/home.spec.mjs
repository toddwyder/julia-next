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
  expect(true, 'JUL-206 controlled browser-failure proof').toBe(false);
});

test('home page exposes an installable Julia manifest and decodable icons', async ({ page, request }) => {
  await page.goto('/');

  const manifestLink = page.locator('link[rel="manifest"]');
  const manifestUrl = new URL(await manifestLink.getAttribute('href'), page.url());
  expect(manifestUrl.origin).toBe(new URL(page.url()).origin);

  const manifestResponse = await request.get(manifestUrl.href);
  expect(manifestResponse.ok(), manifestUrl.href).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: 'Julia',
    short_name: 'Julia',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });

  const icons = manifest.icons;
  expect(icons).toHaveLength(2);
  for (const size of [192, 512]) {
    const icon = icons.find(({ sizes }) => sizes === `${size}x${size}`);
    expect(icon, `${size}x${size} icon`).toBeDefined();
    expect(icon.type).toBe('image/png');
    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.origin).toBe(manifestUrl.origin);
    const iconResponse = await request.get(iconUrl.href);
    expect(iconResponse.ok(), iconUrl.href).toBe(true);
    expect(iconResponse.headers()['content-type'], iconUrl.href).toContain('image/png');
    const dimensions = await page.evaluate(
      (src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(new Error(`Cannot decode ${src}`));
        image.src = src;
      }),
      iconUrl.href,
    );
    expect(dimensions, iconUrl.href).toEqual([size, size]);
  }
  expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThan(0);
});
