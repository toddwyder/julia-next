import { expect, test } from '@playwright/test';

const enabled = process.env.JULIA_PREVIEW_DEMO === '1' || process.env.JULIA_VERIFY_PREVIEW_DEMO === '1';
test.skip(!enabled, 'Requires explicit local JULIA_PREVIEW_DEMO=1 or a target preview with JULIA_VERIFY_PREVIEW_DEMO=1.');
const entries = page => page.locator('ul[aria-label="Recipes"] > li');
const ingredient = (page, id) => page.getByTestId('recipe-ingredients').locator(`[data-ingredient-id="${id}"]`);
const portion = (page, step, id) => page.locator(`[data-step-id="${step}"] [data-ingredient-id="${id}"]`);

test('demo isolation, live search, alphabetical groups, letter anchors and genuine recent opens', async ({ page }) => {
  const writes = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('.googleapis.com') || ['8080', '9099'].includes(url.port) || url.pathname === '/api/recipe-events') writes.push(request.url());
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('julia.recipes.v1', JSON.stringify({ version: 1, recipes: [{ id: 'legacy', title: 'Keep me' }] })));
  const legacy = await page.evaluate(() => localStorage.getItem('julia.recipes.v1'));
  await page.goto('/recipes');
  await expect(entries(page)).toHaveCount(10);
  await expect(page.getByText('Recipes you open will appear here.')).toBeVisible();
  await expect(entries(page).first()).toContainText('Brussels Sprouts Baba Ghanoush');
  await expect(entries(page).getByText('Synthetic', { exact: true })).toHaveCount(10);
  const search = page.getByLabel('Search your collection');
  await search.pressSequentially('Cucumber');
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByText('Recently opened', { exact: true })).toHaveCount(0);
  await search.fill('tahini');
  await expect(entries(page).first()).toContainText('Brussels');
  await search.fill('demonstration kitchen');
  await expect(entries(page)).toHaveCount(10);
  await search.fill('nothing matches this');
  await expect(entries(page)).toHaveCount(0);
  await expect(page.getByText("I couldn't find that in my library.")).toBeVisible();
  await search.clear();
  await page.getByRole('switch', { name: 'Under 30 minutes' }).check();
  await expect(entries(page)).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Jump to B', exact: true })).toHaveCount(0);
  await page.getByRole('switch').uncheck();
  await page.getByRole('link', { name: 'Jump to H', exact: true }).click();
  await expect(page).toHaveURL(/#letter-H$/);
  await page.getByRole('link', { name: 'Homemade Artisan Crackers', exact: true }).click();
  await expect(page.getByTestId('recipe-title')).toHaveText('Homemade Artisan Crackers');
  await page.getByRole('link', { name: '← Library', exact: true }).click();
  await expect(page.locator('details').getByRole('link', { name: 'Homemade Artisan Crackers', exact: true })).toBeVisible();
  await page.locator('details summary').click();
  await expect(page.locator('details').getByRole('link')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('details').getByRole('link', { name: 'Homemade Artisan Crackers', exact: true })).toBeVisible();
  await page.goto('/recipes/new');
  await expect(page.getByRole('heading', { name: 'Preview only' })).toBeVisible();
  await expect(page.getByRole('form')).toHaveCount(0);
  await expect(page.getByLabel('Recipe Title')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('julia.recipes.v1'))).toBe(legacy);
  expect(writes).toEqual([]);
});

test('all quantities, fractions, entity text, saved step and cook navigation use the real recipe', async ({ page }) => {
  await page.goto('/recipes/demo-crackers');
  await expect(ingredient(page, 'flour')).toContainText('2 cups');
  await expect(ingredient(page, 'water')).toContainText('⅔ cup');
  await expect(page.getByTestId('recipe-ingredients').locator('img')).toHaveCount(11);
  expect(await page.getByTestId('recipe-ingredients').locator('img').evaluateAll(images => images.every(i => i.getAttribute('src') === '/apothecary/basket.png'))).toBe(true);
  await page.getByLabel('Servings', { exact: true }).fill('8');
  await expect(ingredient(page, 'flour')).toContainText('4 cups');
  await expect(portion(page, 'mix', 'flour')).toContainText('4 cups');
  await page.getByRole('button', { name: 'Metric', exact: true }).click();
  await expect(ingredient(page, 'flour')).toContainText('500 g');
  await expect(portion(page, 'mix', 'flour')).toContainText('500 g');
  await expect(portion(page, 'mix', 'oil')).toContainText('60 ml');
  await expect(portion(page, 'roll', 'oil')).toContainText('30 ml');
  await page.getByLabel('Servings', { exact: true }).fill('80');
  await expect(ingredient(page, 'flour')).toContainText('5,000 g');
  await page.getByLabel('Servings', { exact: true }).fill('1');
  await expect(ingredient(page, 'flour')).toContainText('62.5 g');
  await expect(page.getByTestId('recipe-steps')).toContainText('it’s smooth & no longer sticky');
  await expect(page.locator('main')).toContainText('café plate — crisp');
  expect(await page.locator('main').innerText()).not.toMatch(/&#|&amp;|&eacute;/);
  await expect(page.getByRole('region', { name: 'Step 3', exact: true })).toContainText('No ingredients');
  await expect(page.locator('main')).toContainText('Score estimated');
  await expect(page.locator('main')).toContainText('Glycemic load estimated');
  const knead = page.getByRole('region', { name: 'Step 2', exact: true });
  await knead.focus();
  await expect(knead).toContainText('You stopped here');
  await page.getByRole('link', { name: '← Library', exact: true }).click();
  await page.goto('/recipes/demo-crackers');
  await expect(knead).toContainText('You stopped here');
  await page.reload();
  await expect(knead).toContainText('You stopped here');
  await page.getByRole('button', { name: 'Start cooking', exact: true }).click();
  await expect(knead).toBeVisible();
  await expect(page.getByRole('group', { name: 'Cook mode', exact: true })).toContainText('Step 2 of 6');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Step 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(knead).toBeVisible();
  await page.getByRole('button', { name: 'Exit cooking', exact: true }).click();
  await expect(ingredient(page, 'flour')).toBeVisible();
});

for (const width of [390, 768, 1280, 1440]) {
  test(`Apothecary layout stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/recipes');
    await expect(entries(page)).toHaveCount(10);
    expect(await page.locator('header').evaluate(el => el.getBoundingClientRect().height)).toBe(width <= 900 ? 76 : 112);
    const logo = page.locator('header img');
    const ratio = await logo.evaluate(img => img.getBoundingClientRect().width / img.getBoundingClientRect().height);
    expect(ratio).toBeCloseTo(770 / 244, 1);
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    if (width <= 900) {
      expect(await nav.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
      await expect(page.locator('header').getByRole('link', { name: 'Add recipe', exact: true })).not.toBeVisible();
      await expect(page.locator('main').getByRole('link', { name: 'Add recipe', exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Lab', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Lab', exact: true }).focus();
    await page.getByRole('button', { name: 'Lab', exact: true }).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Lab is not available yet.' })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.getByRole('link', { name: 'Jump to H', exact: true }).click();
    await page.getByRole('link', { name: 'Homemade Artisan Crackers', exact: true }).click();
    await expect(page.getByTestId('recipe-title')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replaceAll(/['"]/g, ''));
    });
    expect(loaded).toContain('IM Fell English');
    expect(loaded).toContain('Libre Caslon Text');
    await expect(page.locator('link[rel="icon"][href="/apothecary/julia-tab-icon.png"]')).toHaveCount(1);
  });
}
