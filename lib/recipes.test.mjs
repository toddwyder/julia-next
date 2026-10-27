import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { collection, getDocs } from 'firebase/firestore';

import { householdEmulator, KATINA, TODD } from './household-emulator.mjs';
import { getRecipe, LIBRARY_KEY, listRecipes, moveBrowserRecipes, newRecipeId, saveRecipe } from './recipes.js';

let household;
before(async () => { household = await householdEmulator(); });
after(() => household?.stop());
beforeEach(() => household.clear());

const TYPED = {
  title: "  Grandmère's  <b>&amp;</b> Coq au Vin 🍷  ",
  ingredients: '\n  2 tbsp butter\t\n\n1 free-range chicken 🐔\n  12 shallots  \n',
  steps: '  Brown the bird.\n\n\tSimmer 40 minutes.\n  Rest, then carve.\n',
};

const storedIds = async () => (await household.admin(db => getDocs(collection(db, 'recipes')))).docs.map(stored => stored.id).sort();

// The browser's Storage, reduced to the two methods the move uses.
function browserStorage(recipes, { removeFails = false } = {}) {
  const entries = new Map(recipes === undefined ? [] : [[LIBRARY_KEY, typeof recipes === 'string' ? recipes : JSON.stringify({ version: 1, recipes })]]);
  return {
    has: () => entries.has(LIBRARY_KEY),
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    removeItem: key => {
      if (removeFails) throw new Error('the browser closed');
      entries.delete(key);
    },
  };
}

const browserRecipe = (id, title, createdAt) => ({ id, title, ingredients: 'salt', steps: 'stir', createdAt });

test('a saved recipe keeps every character of the typed text, and the other member opens it', async () => {
  const recipe = await saveRecipe(household.as(TODD), 'r1', TYPED);
  assert.deepEqual(recipe, { id: 'r1', ...TYPED, createdAt: recipe.createdAt });
  assert.ok(!Number.isNaN(Date.parse(recipe.createdAt)));
  assert.deepEqual(await getRecipe(household.as(KATINA), 'r1'), recipe);
});

test('saving the same id again, even with other text, keeps the first recipe and stores one', async () => {
  const first = await saveRecipe(household.as(TODD), 'r1', TYPED);
  const again = await saveRecipe(household.as(TODD), 'r1', { title: 'Other', ingredients: '', steps: '' });
  assert.deepEqual(again, first);
  assert.deepEqual(await storedIds(), ['r1']);
});

test('two devices saving the same id at the same moment store one recipe and both see it', async () => {
  const [onPhone, onDesktop] = await Promise.all([
    saveRecipe(household.as(TODD), 'r1', { ...TYPED, title: 'From the phone' }),
    saveRecipe(household.as(KATINA), 'r1', { ...TYPED, title: 'From the desktop' }),
  ]);
  assert.deepEqual(onPhone, onDesktop);
  assert.deepEqual(await storedIds(), ['r1']);
});

test('two recipes with the same text but different ids are two recipes', async () => {
  await saveRecipe(household.as(TODD), 'r1', TYPED);
  await saveRecipe(household.as(TODD), 'r2', TYPED);
  assert.deepEqual(await storedIds(), ['r1', 'r2']);
});

test('a title that is empty or only whitespace is refused and nothing is stored', async () => {
  for (const title of ['', '  \n\t ']) {
    await assert.rejects(saveRecipe(household.as(TODD), 'r1', { ...TYPED, title }), /needs a title/);
  }
  assert.deepEqual(await storedIds(), []);
});

test('the library lists newest first and finds any part of a title in any case', async () => {
  const db = household.as(TODD);
  await saveRecipe(db, 'old', { ...TYPED, title: 'Chicken Soup' }, '2026-01-01T00:00:00.000Z');
  await saveRecipe(db, 'new', { ...TYPED, title: 'Coq au Vin' }, '2026-02-01T00:00:00.000Z');
  assert.deepEqual((await listRecipes(db)).map(({ id }) => id), ['new', 'old']);
  assert.deepEqual((await listRecipes(db, '  ')).map(({ id }) => id), ['new', 'old']);
  assert.deepEqual((await listRecipes(db, 'CHICK')).map(({ id }) => id), ['old']);
  assert.deepEqual(await listRecipes(db, 'lasagne'), []);
});

test('get returns null for an id that is not stored', async () => {
  assert.equal(await getRecipe(household.as(TODD), 'missing'), null);
});

test('the move stores each browser recipe under its id and date, then empties the browser', async () => {
  const storage = browserStorage([browserRecipe('a', 'Bread', '2025-05-01T00:00:00.000Z'), browserRecipe('b', 'Jam', '2025-06-01T00:00:00.000Z')]);
  assert.equal(await moveBrowserRecipes(household.as(TODD), storage), 2);
  assert.equal(storage.has(), false);
  assert.deepEqual(await getRecipe(household.as(KATINA), 'a'), browserRecipe('a', 'Bread', '2025-05-01T00:00:00.000Z'));
  assert.deepEqual((await listRecipes(household.as(KATINA))).map(({ id }) => id), ['b', 'a']);
});

test('a move cut off before the browser is emptied, then run again, stores each recipe once', async () => {
  const recipes = [browserRecipe('a', 'Bread', '2025-05-01T00:00:00.000Z'), browserRecipe('b', 'Jam', '2025-06-01T00:00:00.000Z')];
  const interrupted = browserStorage(recipes, { removeFails: true });
  await assert.rejects(moveBrowserRecipes(household.as(TODD), interrupted), /browser closed/);
  assert.equal(interrupted.has(), true);
  const retried = browserStorage(recipes);
  assert.equal(await moveBrowserRecipes(household.as(TODD), retried), 2);
  assert.equal(retried.has(), false);
  assert.deepEqual(await storedIds(), ['a', 'b']);
});

test('the same browser recipes moved from two tabs at once are stored once', async () => {
  const recipes = [browserRecipe('a', 'Bread', '2025-05-01T00:00:00.000Z'), browserRecipe('b', 'Jam', '2025-06-01T00:00:00.000Z')];
  await Promise.all([moveBrowserRecipes(household.as(TODD), browserStorage(recipes)), moveBrowserRecipes(household.as(TODD), browserStorage(recipes))]);
  assert.deepEqual(await storedIds(), ['a', 'b']);
});

test('a browser recipe the library refuses keeps every browser recipe on the device', async () => {
  const storage = browserStorage([browserRecipe('a', 'Bread', '2025-05-01T00:00:00.000Z'), browserRecipe('b', '   ', '2025-06-01T00:00:00.000Z')]);
  await assert.rejects(moveBrowserRecipes(household.as(TODD), storage));
  assert.equal(storage.has(), true);
});

test('unreadable browser data is never moved or removed', async () => {
  for (const unreadable of ['{not json', JSON.stringify({ version: 2, recipes: [] }), JSON.stringify({ version: 1, recipes: [{ id: 'a' }] })]) {
    const storage = browserStorage(unreadable);
    await assert.rejects(moveBrowserRecipes(household.as(TODD), storage), /left untouched/);
    assert.equal(storage.has(), true);
  }
  assert.deepEqual(await storedIds(), []);
});

test('a browser with no recipes moves nothing', async () => {
  assert.equal(await moveBrowserRecipes(household.as(TODD), browserStorage(undefined)), 0);
});

test('newRecipeId gives a different id each time', () => {
  const ids = new Set(Array.from({ length: 100 }, () => newRecipeId()));
  assert.equal(ids.size, 100);
});
