import test from 'node:test';
import assert from 'node:assert/strict';

import { LIBRARY_KEY, openRecipeLibrary, newRecipeId } from './recipes.js';

// The browser's Storage object is two methods, so a Map with the same two
// methods is the real interface the library is handed in the app.
function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  const storage = {
    writes: 0,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => {
      storage.writes += 1;
      entries.set(key, String(value));
    },
  };
  return storage;
}

const TYPED = {
  title: "  Grandmère's  <b>&amp;</b> Coq au Vin 🍷  ",
  ingredients: '\n  2 tbsp butter\t\n\n1 free-range chicken 🐔\n  12 shallots  \n',
  steps: '  Brown the bird.\n\n\tSimmer 40 minutes.\n  Rest, then carve.\n',
};

function saved(storage, id, fields = TYPED) {
  return openRecipeLibrary(storage).save(id, fields);
}

test('a saved recipe keeps every character of the typed text when it is read back', () => {
  const storage = createStorage();
  const recipe = saved(storage, 'r1');

  assert.deepEqual(recipe, { id: 'r1', ...TYPED, createdAt: recipe.createdAt });
  assert.equal(typeof recipe.createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(recipe.createdAt)), 'createdAt must be an ISO timestamp');

  assert.deepEqual(openRecipeLibrary(storage).get('r1'), recipe);
  assert.deepEqual(openRecipeLibrary(storage).list().map(({ id }) => id), ['r1']);
});

test('saving the same id twice stores one recipe and leaves it unchanged', () => {
  const storage = createStorage();
  const first = saved(storage, 'r1');
  const writesAfterFirst = storage.writes;

  const second = openRecipeLibrary(storage).save('r1', { title: 'Something else', ingredients: '', steps: '' });

  assert.deepEqual(second, first);
  assert.equal(storage.writes, writesAfterFirst, 'the second save must not write again');
  assert.equal(openRecipeLibrary(storage).list().length, 1);
  assert.equal(openRecipeLibrary(storage).get('r1').title, TYPED.title);
});

test('two recipes with the same text but different ids are two recipes', () => {
  const storage = createStorage();
  saved(storage, 'r1');
  saved(storage, 'r2');

  const recipes = openRecipeLibrary(storage).list();
  assert.equal(recipes.length, 2);
  assert.deepEqual(recipes.map(({ title }) => title), [TYPED.title, TYPED.title]);
});

test('list returns the newest recipe first', () => {
  const storage = createStorage();
  saved(storage, 'first', { title: 'First', ingredients: '', steps: '' });
  saved(storage, 'second', { title: 'Second', ingredients: '', steps: '' });
  saved(storage, 'third', { title: 'Third', ingredients: '', steps: '' });

  assert.deepEqual(openRecipeLibrary(storage).list().map(({ id }) => id), ['third', 'second', 'first']);
});

test('list finds any part of a title in any case, and a blank query returns everything', () => {
  const storage = createStorage();
  saved(storage, 'r1', { title: 'Coq au Vin', ingredients: '', steps: '' });
  saved(storage, 'r2', { title: 'Lemon Drizzle Cake', ingredients: '', steps: '' });
  const library = openRecipeLibrary(storage);

  assert.deepEqual(library.list('coq').map(({ id }) => id), ['r1']);
  assert.deepEqual(library.list('AU V').map(({ id }) => id), ['r1']);
  assert.deepEqual(library.list('DRizzle').map(({ id }) => id), ['r2']);
  assert.deepEqual(library.list('zzz'), []);
  assert.deepEqual(library.list('').map(({ id }) => id), ['r2', 'r1']);
  assert.deepEqual(library.list('   ').map(({ id }) => id), ['r2', 'r1']);
});

test('get returns null for an id that is not stored', () => {
  const storage = createStorage();
  saved(storage, 'r1');

  assert.equal(openRecipeLibrary(storage).get('r9'), null);
  assert.equal(openRecipeLibrary(createStorage()).get('r1'), null);
});

test('unreadable stored data makes every call throw and no save writes', () => {
  for (const stored of ['{not json', 'null', '[]', JSON.stringify({ version: 2, recipes: [] }), JSON.stringify({ version: 1, recipes: [{ id: 'r1' }] })]) {
    const storage = createStorage({ [LIBRARY_KEY]: stored });
    const library = openRecipeLibrary(storage);

    assert.throws(() => library.save('r1', TYPED), `${stored} must refuse a save`);
    assert.throws(() => library.list(), `${stored} must refuse a list`);
    assert.throws(() => library.get('r1'), `${stored} must refuse a get`);
    assert.equal(storage.writes, 0, `${stored} must be left untouched`);
    assert.equal(storage.getItem(LIBRARY_KEY), stored);
  }
});

test('a title that is empty or only whitespace is refused and nothing is written', () => {
  for (const title of ['', ' ', '\n\t ']) {
    const storage = createStorage();

    assert.throws(() => saved(storage, 'r1', { title, ingredients: '', steps: '' }), /needs a title/, JSON.stringify(title));
    assert.equal(storage.writes, 0, JSON.stringify(title));
    assert.equal(storage.getItem(LIBRARY_KEY), null);
  }
});

test('a storage that refuses the write makes save throw', () => {
  const refusing = {
    getItem: () => null,
    setItem: () => { throw new Error('write refused'); },
  };

  assert.throws(() => saved(refusing, 'r1'), /write refused/);
});

test('newRecipeId gives a different id each time', () => {
  const first = newRecipeId();
  const second = newRecipeId();

  assert.equal(typeof first, 'string');
  assert.ok(first.length > 0);
  assert.notEqual(first, second);
});
