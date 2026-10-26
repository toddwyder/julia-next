import { expect, test } from '@playwright/test';

const LIBRARY_KEY = 'julia.recipes.v1';

const TYPED = {
  title: "  Grandmère's Coq au Vin  ",
  ingredients: '  2 tbsp butter\n\n1 free-range chicken\n  12 shallots  \n',
  steps: '  Brown the bird in the butter.\n\n\tSimmer 40 minutes.\n  Rest, then carve.\n',
};

const A = { title: 'Coq au Vin', ingredients: '1 chicken', steps: 'Simmer.' };
const B = { title: 'Lemon Drizzle Cake', ingredients: '2 lemons', steps: 'Bake.' };

const rows = page => page.locator('ul[aria-label="Recipes"] li');

async function startEmpty(page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/recipes/new');
}

async function fillForm(page, fields) {
  await page.getByLabel('Recipe Title').fill(fields.title);
  await page.getByLabel('Ingredients').fill(fields.ingredients);
  await page.getByLabel('Instructions').fill(fields.steps);
}

async function save(page, fields) {
  await page.goto('/recipes/new');
  await fillForm(page, fields);
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/[^/]+$/);
}

function shownText(page) {
  return page.evaluate(() => ({
    title: document.querySelector('[data-testid="recipe-title"]')?.textContent ?? null,
    ingredients: document.querySelector('[data-testid="recipe-ingredients"]')?.textContent ?? null,
    steps: document.querySelector('[data-testid="recipe-steps"]')?.textContent ?? null,
  }));
}

test('a saved recipe survives a reload and shows the typed text exactly', async ({ page }) => {
  await startEmpty(page);
  await fillForm(page, TYPED);
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/[^/]+$/);
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);

  await page.reload();
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);

  await page.getByLabel('Search your collection').fill('COQ AU');
  await expect(rows(page)).toHaveCount(1);

  await rows(page).locator('a').click();
  await page.waitForURL(/\/recipes\/[^/]+$/);
  await expect(page.getByTestId('recipe-title')).toBeVisible();
  expect(await shownText(page)).toEqual(TYPED);
});

test('Cancel adds nothing', async ({ page }) => {
  await startEmpty(page);
  await fillForm(page, TYPED);

  await page.getByRole('link', { name: 'Cancel' }).click();
  await page.waitForURL(/\/recipes$/);

  await expect(rows(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('julia.recipes.v1'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
});

test('two Save submissions in one task store one recipe', async ({ page }) => {
  await startEmpty(page);
  await fillForm(page, A);

  await page.evaluate(() => {
    const form = document.querySelector('form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.waitForURL(/\/recipes\/[^/]+$/);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('julia.recipes.v1')).recipes.length)).toBe(1);
});

test('a double click on Save stores one recipe', async ({ page }) => {
  await startEmpty(page);
  await fillForm(page, A);

  await page.getByRole('button', { name: 'Save Recipe' }).dblclick();
  await page.waitForURL(/\/recipes\/[^/]+$/);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('julia.recipes.v1')).recipes.length)).toBe(1);
});

test('an empty search lists the newest recipe first', async ({ page }) => {
  await startEmpty(page);
  await save(page, A);
  await save(page, B);

  await page.goto('/recipes');
  await expect(rows(page)).toHaveCount(2);
  expect(await rows(page).locator('a').allTextContents()).toEqual([B.title, A.title]);

  expect(await page.evaluate(key => JSON.parse(window.localStorage.getItem(key)).recipes.length, LIBRARY_KEY)).toBe(2);
});
