import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { TODD, resetHousehold, signIn } from './household.mjs';

// Every expected colour and font is read from the design document, so these
// checks fail when the screens drift from DESIGN-LANGUAGE.md or the document changes.
const DESIGN = readFileSync(new URL('../../../../docs/design/vintage/DESIGN-LANGUAGE.md', import.meta.url), 'utf8');

function designRow(label) {
  const row = DESIGN.split('\n').find(line => line.startsWith(`| **${label}`));
  if (!row) throw new Error(`DESIGN-LANGUAGE.md has no table row starting "| **${label}"`);
  return row;
}

function colour(label) {
  const hex = designRow(label).match(/`#([0-9A-Fa-f]{6})`/)[1];
  const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function font(label) {
  return designRow(label).split('|')[2].replaceAll('*', '').trim();
}

const PAPER = colour('Cream page background');
const INK = colour('Ink');
const BUTTON = colour('Dark green: buttons and active states');
const HEADING = colour('Forest green: headings');
const TERRACOTTA = colour('Terracotta accent');
const ACTIVE_TAB = colour('Pale green: active nav tab fill');
const SERIF = font('Serif');
const SANS = font('Sans');
const MONO = font('Mono');

function style(locator) {
  return locator.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      color: computed.color,
      background: computed.backgroundColor,
      font: computed.fontFamily.split(',')[0].replaceAll(/["']/g, '').trim(),
    };
  });
}

test.beforeEach(async () => {
  await resetHousehold();
});

test('the design fonts are loaded, not only named', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Enter a Recipe' })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replaceAll(/["']/g, ''));
  });
  for (const family of [SERIF, SANS, MONO]) expect(loaded, family).toContain(family);
});

test('Library uses the locked Apothecary paper, shell, search and title fonts', async ({ page }) => {
  await signIn(page, TODD);
  expect(await style(page.locator('header'))).toMatchObject({ background: 'rgb(111, 124, 90)' });
  expect(await style(page.locator('main'))).toMatchObject({ color: 'rgb(46, 33, 25)', font: 'Libre Caslon Text' });
  expect(await style(page.getByRole('heading', { level: 1, name: 'Library' }))).toMatchObject({ font: 'Libre Caslon Text' });
  expect(await style(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library' })))
    .toMatchObject({ color: 'rgb(246, 241, 230)', font: 'IM Fell English' });
  expect(await style(page.getByLabel('Search your collection'))).toMatchObject({ color: 'rgb(46, 33, 25)', font: 'Libre Caslon Text' });
  await expect(page.getByRole('link', { name: 'Manual Entry' })).toBeVisible();
});

test('Enter a Recipe uses the vintage buttons, inputs and fonts', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');

  expect(await style(page.getByRole('heading', { level: 1, name: 'Enter a Recipe' }))).toMatchObject({ color: HEADING, font: SERIF });
  expect(await style(page.getByRole('heading', { name: 'Recipe Info' }))).toMatchObject({ color: HEADING, font: SERIF });
  expect(await style(page.getByLabel('Recipe Title'))).toMatchObject({ background: PAPER, font: SANS });
  expect(await style(page.getByLabel('Ingredients'))).toMatchObject({ background: PAPER, font: MONO });
  expect(await style(page.getByLabel('Instructions'))).toMatchObject({ background: PAPER, font: MONO });
  expect(await style(page.getByRole('button', { name: 'Save Recipe' }))).toEqual({ color: PAPER, background: BUTTON, font: SANS });
  expect(await style(page.getByRole('link', { name: 'Cancel' }))).toMatchObject({ background: PAPER, font: SANS });
});

test('a written Recipe uses Apothecary type and preserves its reading text', async ({ page }) => {
  await signIn(page, TODD);
  await page.goto('/recipes/new');
  await page.getByLabel('Recipe Title').fill('Coq au Vin');
  await page.getByLabel('Ingredients').fill('1 chicken\n12 shallots');
  await page.getByLabel('Instructions').fill('Brown the bird.\nSimmer.');
  await page.getByRole('button', { name: 'Save Recipe' }).click();
  await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/);

  expect(await style(page.getByTestId('recipe-title'))).toMatchObject({ color: 'rgb(46, 33, 25)', font: 'IM Fell English' });
  expect(await style(page.getByRole('heading', { name: 'The Ingredients' }))).toMatchObject({ color: 'rgb(111, 124, 90)', font: 'IM Fell English' });
  expect(await style(page.getByText('12 shallots'))).toMatchObject({ color: 'rgb(46, 33, 25)', font: 'Libre Caslon Text' });
  expect(await style(page.getByText('Brown the bird.'))).toMatchObject({ color: 'rgb(46, 33, 25)', font: 'Libre Caslon Text' });
  expect(await style(page.getByRole('link', { name: '← Library' }))).toMatchObject({ color: 'rgb(90, 62, 46)', font: 'IM Fell English' });
});
