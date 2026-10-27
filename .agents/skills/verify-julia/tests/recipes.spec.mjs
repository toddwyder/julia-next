import { expect, test } from '@playwright/test';

import { KATINA, STRANGER, TODD, googlePopup, resetHousehold, signIn, storedRecipeCount } from './household.mjs';

const LIBRARY_KEY = 'julia.recipes.v1';

const TYPED = {
  title: "  Grandmère's Coq au Vin  ",
  ingredients: '  2 tbsp butter\n\n1 free-range chicken\n  12 shallots  \n',
  steps: '  Brown the bird in the butter.\n\n\tSimmer 40 minutes.\n  Rest, then carve.\n',
};

const A = { title: 'Coq au Vin', ingredients: '1 chicken', steps: 'Simmer.' };
const B = { title: 'Lemon Drizzle Cake', ingredients: '2 lemons', steps: 'Bake.' };

const rows = page => page.locator('ul[aria-label="Recipes"] li');

test.beforeEach(async () => {
  await resetHousehold();
});

async function fillForm(page, fields) {
  await page.getByLabel('Recipe Title').fill(fields.title);
  await page.getByLabel('Ingredients').fill(fields.ingredients);
  await page.getByLabel('Instructions').fill(fields.steps);
}

async function save(page, fields) {
  await page.goto('/recipes/new');
  await fillForm(page, fields);
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
}

function shownText(page) {
  return page.evaluate(() => ({
    title: document.querySelector('[data-testid="recipe-title"]')?.textContent ?? null,
    ingredients: document.querySelector('[data-testid="recipe-ingredients"]')?.textContent ?? null,
    steps: document.querySelector('[data-testid="recipe-steps"]')?.textContent ?? null,
  }));
}

test('a signed-out browser sees only the sign-in, on every recipe page', async ({ page }) => {
  for (const path of ['/recipes', '/recipes/new', '/recipes/some-id']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByText('The recipe library is private to the household')).toBeVisible();
    await expect(page.getByLabel('Recipe Title')).toHaveCount(0);
    await expect(page.getByLabel('Search your collection')).toHaveCount(0);
    await expect(page.getByLabel('Test user email')).toHaveCount(0);
  }
});

test('a Google account outside the household is turned away and signed out', async ({ page }) => {
  await page.goto('/recipes');
  const popup = await googlePopup(page);
  await popup.locator('#add-account-button button').click();
  await popup.locator('#email-input').fill(STRANGER);
  const reported = page.waitForRequest(request => request.url().endsWith('/api/recipe-events'));
  await popup.locator('#sign-in').click();

  await expect(page.getByText(`${STRANGER} is not part of this household`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another Google account' })).toBeVisible();
  await expect(page.getByLabel('Search your collection')).toHaveCount(0);
  expect((await reported).postDataJSON()).toEqual({ action: 'sign-in', outcome: 'turned-away' });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

test('a saved recipe survives a reload, shows the typed text exactly, and opens for the other member', async ({ page, browser }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await fillForm(page, TYPED);
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);
  const address = new URL(page.url()).pathname;

  await page.reload();
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel('Search your collection').fill('COQ AU');
  await expect(rows(page)).toHaveCount(1);
  await rows(page).locator('a').click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);

  const otherDevice = await browser.newContext();
  const katina = await otherDevice.newPage();
  await signIn(katina, KATINA);
  await expect(rows(katina)).toHaveCount(1);
  await katina.goto(address);
  await expect(katina.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(katina)).toEqual(TYPED);
  await otherDevice.close();
});

test('Cancel adds nothing', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await fillForm(page, TYPED);

  await page.getByRole('link', { name: 'Cancel' }).click();
  await page.waitForURL(/\/recipes$/);

  await expect(page.getByText('Your library is empty.')).toBeVisible();
  expect(await storedRecipeCount()).toBe(0);
});

test('two Save submissions in one task store one recipe', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await fillForm(page, A);

  await page.evaluate(() => {
    const form = document.querySelector('form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);
  expect(await storedRecipeCount()).toBe(1);
});

test('a double click on Save stores one recipe', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await fillForm(page, A);

  await page.getByRole('button', { name: 'Save Recipe' }).dblclick();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);
  expect(await storedRecipeCount()).toBe(1);
});

test('an empty search lists the newest recipe first', async ({ page }) => {
  await signIn(page, TODD);
  await save(page, A);
  await save(page, B);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(2);
  expect(await rows(page).locator('a').allTextContents()).toEqual([B.title, A.title]);
  expect(await storedRecipeCount()).toBe(2);
});

test('recipes kept in this browser move to the household library on sign-in and leave the browser', async ({ page, browser }) => {
  const kept = [
    { id: 'kept-2', title: 'Shortbread', ingredients: 'butter\nsugar\nflour\n', steps: 'Bake low.', createdAt: '2026-10-20T09:00:00.000Z' },
    { id: 'kept-1', title: 'Pea Soup', ingredients: 'peas', steps: 'Simmer.', createdAt: '2026-10-10T09:00:00.000Z' },
  ];
  await page.goto('/');
  await page.evaluate(([key, recipes]) => window.localStorage.setItem(key, JSON.stringify({ version: 1, recipes })), [LIBRARY_KEY, kept]);

  const moved = page.waitForRequest(request => request.url().endsWith('/api/recipe-events') && request.postDataJSON().action === 'move');
  await signIn(page, TODD);
  expect((await moved).postDataJSON()).toEqual({ action: 'move', outcome: 'ok', count: 2 });

  await expect(rows(page)).toHaveCount(2);
  expect(await rows(page).locator('a').allTextContents()).toEqual(['Shortbread', 'Pea Soup']);
  expect(await page.evaluate(key => window.localStorage.getItem(key), LIBRARY_KEY)).toBeNull();
  expect(await storedRecipeCount()).toBe(2);

  const otherDevice = await browser.newContext();
  const katina = await otherDevice.newPage();
  await signIn(katina, KATINA);
  await katina.goto('/recipes/kept-2');
  await expect(katina.getByTestId('recipe-ingredients')).toBeVisible();
  expect(await shownText(katina)).toEqual({ title: 'Shortbread', ingredients: 'butter\nsugar\nflour\n', steps: 'Bake low.' });
  await otherDevice.close();
});

test('a save that cannot reach the library says so, keeps the form, and is reported', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await fillForm(page, A);

  await page.route('http://127.0.0.1:8080/**', route => route.abort('internetdisconnected'));
  const reported = page.waitForRequest(request => request.url().endsWith('/api/recipe-events'), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save Recipe' }).click();

  await expect(page.getByText('Julia could not save this recipe.')).toBeVisible({ timeout: 60_000 });
  expect((await reported).postDataJSON()).toMatchObject({ action: 'save', outcome: 'failed' });
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByLabel('Recipe Title')).toHaveValue(A.title);

  await page.unroute('http://127.0.0.1:8080/**');
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);
  expect(await storedRecipeCount()).toBe(1);
});
