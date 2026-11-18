import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRecipeText, decodeDemoRecipe, fromStoredRecipe, formatAmount, projectAmounts, queryLibrary, validateDemoRecipes } from './recipe-display.js';
import { demoRecipes } from './recipe-demo-data.js';
import { recipePreviewEnabled } from './recipe-preview-mode.js';

const recipes = demoRecipes.map(decodeDemoRecipe);
const crackers = recipes.find(r => r.id === 'demo-crackers');

test('all authored fixtures have valid quantities, key ingredients and complete portion shares', () => {
  assert.equal(validateDemoRecipes(demoRecipes).length, 10);
  const broken = structuredClone(demoRecipes);
  broken[0].content.steps[0].portions[0].share = 0.5;
  assert.throws(() => validateDemoRecipes(broken), /Portions must use the total/);
  broken[0].content.steps[0].portions[0].ingredientId = 'absent';
  assert.throws(() => validateDemoRecipes(broken), /Invalid portion/);
});

test('base and double servings scale full ingredients and split portions from the same base', () => {
  const base = projectAmounts(crackers.content, { servings: 4, units: 'us' });
  assert.equal(base.ingredients[0].amount, '2 cups');
  assert.equal(base.steps[0].ingredients[0].amount, '2 cups');
  assert.equal(base.ingredients.find(i => i.ingredientId === 'oil').amount, '3 tbsp');
  assert.equal(base.steps[0].ingredients.find(i => i.ingredientId === 'oil').amount, '2 tbsp');
  assert.equal(base.steps[3].ingredients[0].amount, '1 tbsp');
  const doubled = projectAmounts(crackers.content, { servings: 8, units: 'us' });
  assert.equal(doubled.ingredients[0].amount, '4 cups');
  assert.equal(doubled.steps[0].ingredients[0].amount, '4 cups');
  const metric = projectAmounts(crackers.content, { servings: 8, units: 'metric' });
  assert.equal(metric.ingredients[0].amount, '500 g');
  assert.equal(metric.steps[0].ingredients[0].amount, '500 g');
  assert.equal(metric.steps[0].ingredients.find(i => i.ingredientId === 'oil').amount, '60 ml');
  assert.equal(metric.steps[3].ingredients[0].amount, '30 ml');
  assert.deepEqual(metric.steps[2].ingredients, []);
  assert.equal(projectAmounts(crackers.content, { servings: 4, units: 'metric' }).ingredients[0].amount, '250 g');
  assert.equal(crackers.content.ingredients[0].amount.us.value, 2);
});

test('quantities support one and more than 75 servings, fractions and small nonzero amounts', () => {
  assert.equal(projectAmounts(crackers.content, { servings: 1, units: 'us' }).ingredients[0].amount, '½ cup');
  assert.equal(projectAmounts(crackers.content, { servings: 80, units: 'metric' }).ingredients[0].amount, '5,000 g');
  assert.equal(projectAmounts(crackers.content, { servings: 4, units: 'us' }).ingredients[6].amount, '⅔ cup');
  assert.notEqual(formatAmount({ us: { value: 0.00001, unit: 'tsp' } }, 'us'), '0 tsp');
});

test('entities decode once as inert text and preserve original whitespace', () => {
  assert.equal(decodeRecipeText('  it&#8217;s &amp; caf&eacute; &#x2014;\n\t&lt;script&gt;  '), '  it’s & café —\n\t<script>  ');
  assert.equal(decodeRecipeText('&amp;#8217;'), '&#8217;');
  assert.equal(decodeRecipeText('&unknown;'), '&unknown;');
  const raw = { id: 'plain', title: "  Grandmère's title  ", ingredients: '  2 tbsp butter\n\n\twater  \n', steps: '  Stir.\n\n\tRest.\n' };
  const display = fromStoredRecipe(raw);
  assert.equal(display.title, raw.title);
  assert.equal(display.content.ingredients, raw.ingredients);
  assert.equal(display.content.steps, raw.steps);
  assert.equal(display.content.kind, 'written');
  assert.equal(display.totalMinutes, null);
  assert.equal(display.nutrition, null);
  assert.deepEqual(display.keyIngredients, []);
});

test('library groups alphabetically and searches decoded names, ingredients and sources each time', () => {
  const all = queryLibrary(recipes);
  assert.deepEqual(all.map(g => g.letter), ['B', 'C', 'D', 'F', 'H', 'R', 'S']);
  assert.equal(queryLibrary(recipes, { text: 'Cucumber Crunch' })[0].recipes[0].id, 'demo-cucumber');
  assert.equal(queryLibrary(recipes, { text: 'tahini' })[0].recipes[0].id, 'demo-brussels');
  assert.equal(queryLibrary(recipes, { text: 'demonstration kitchen' }).flatMap(g => g.recipes).length, 10);
  const accented = fromStoredRecipe({ id: 'accent', title: 'Caf&eacute; &amp; citron', ingredients: 'citron', steps: '' });
  assert.equal(queryLibrary([accented], { text: 'cafe &amp;' })[0].recipes[0].id, 'accent');
  assert.equal(queryLibrary(recipes, { text: 'nothingmatches' }).length, 0);
  const partialCounts = ['c', 'cu', 'cuc'].map(text => queryLibrary(recipes, { text }).flatMap(g => g.recipes).length);
  assert.ok(partialCounts[0] > partialCounts[1]);
  assert.equal(partialCounts[2], 1);
});

test('under 30 excludes unknown times and exactly 30, and enabled letters follow the filter', () => {
  const known = recipes.find(r => r.id === 'demo-cucumber');
  const unknown = fromStoredRecipe({ id: 'unknown', title: 'Unknown', ingredients: '', steps: '' });
  assert.deepEqual(queryLibrary([unknown, { ...known, id: 'thirty', totalMinutes: 30 }, known], { under30: true }).map(g => g.letter), ['C']);
  assert.equal(queryLibrary([unknown, { ...known, totalMinutes: 30 }], { under30: true }).length, 0);
});

test('only a server preview or explicit local flag enables demo and production always refuses it', () => {
  assert.equal(recipePreviewEnabled({}), false);
  assert.equal(recipePreviewEnabled({ VERCEL: '1' }), false);
  assert.equal(recipePreviewEnabled({ JULIA_PREVIEW_DEMO: '1' }), true);
  assert.equal(recipePreviewEnabled({ VERCEL_ENV: 'preview', VERCEL: '1' }), true);
  assert.equal(recipePreviewEnabled({ VERCEL_ENV: 'production', JULIA_PREVIEW_DEMO: '1' }), false);
  assert.equal(recipePreviewEnabled({ VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'production', JULIA_PREVIEW_DEMO: '1' }), false);
  assert.equal(recipePreviewEnabled({ NEXT_PUBLIC_JULIA_PREVIEW_DEMO: '1' }), false);
});
