import assert from 'node:assert/strict';
import test from 'node:test';
import { markLastStep, markOpened, readLastStep, recentRecipes } from './recipe-history.js';
import { demoRecipes } from './recipe-demo-data.js';

function storage() {
  const values = new Map([['julia.recipes.v1', 'household data']]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('recent starts empty, records actual opens, deduplicates and keeps the last five existing recipes', () => {
  const local = storage();
  assert.deepEqual(recentRecipes(local, 'demo', demoRecipes), []);
  demoRecipes.slice(0, 7).forEach((r, i) => markOpened(local, 'demo', r.id, i + 1));
  markOpened(local, 'demo', demoRecipes[0].id, 20);
  assert.deepEqual(recentRecipes(local, 'demo', demoRecipes).map(r => r.id), [0, 6, 5, 4, 3].map(i => demoRecipes[i].id));
  assert.equal(recentRecipes(local, 'demo', demoRecipes.slice(1)).length, 5);
  assert.deepEqual(recentRecipes(local, 'household:user', demoRecipes), []);
  assert.equal(local.getItem('julia.recipes.v1'), 'household data');
});

test('last step restores per recipe and scope independently of opened history', () => {
  const local = storage();
  const a = demoRecipes[0];
  const b = demoRecipes[1];
  markLastStep(local, 'demo', a.id, 'knead');
  markLastStep(local, 'demo', b.id, 'blend');
  markOpened(local, 'demo', a.id, 1);
  assert.equal(readLastStep(local, 'demo', a), 'knead');
  assert.equal(readLastStep(local, 'demo', b), 'blend');
  assert.equal(readLastStep(local, 'household:user', a), null);
  markLastStep(local, 'demo', a.id, 'deleted-step');
  assert.equal(readLastStep(local, 'demo', a), null);
});

test('malformed, obsolete, denied or full storage does not stop reading', () => {
  const local = storage();
  markOpened(local, 'demo', demoRecipes[0].id, 1);
  const name = [...local.values.keys()].find(k => k.includes(':opened:'));
  local.setItem(name, '{');
  assert.deepEqual(recentRecipes(local, 'demo', demoRecipes), []);
  local.setItem(name, JSON.stringify({ version: 2, openedAt: 1 }));
  assert.deepEqual(recentRecipes(local, 'demo', demoRecipes), []);
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  assert.doesNotThrow(() => markOpened(denied, 'demo', demoRecipes[0].id));
  assert.equal(readLastStep(denied, 'demo', demoRecipes[0]), null);
  assert.deepEqual(recentRecipes(denied, 'demo', demoRecipes), []);
});
