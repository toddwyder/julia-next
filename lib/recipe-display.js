import { decode } from 'html-entities';

/**
 * Display recipes have common metadata and one content variant.
 * linked: { baseServings, ingredients: [{ id, name, amount: { us, metric } | { text } }],
 *   steps: [{ id, instruction, portions: [{ ingredientId, share }] }] }.
 * written: { ingredients: string, steps: string }. Unknown metadata is null.
 * A measure is { value: number, unit: string }. Portions share immutable totals.
 */
export function decodeRecipeText(text) {
  return decode(text, { level: 'html5', scope: 'strict' });
}

export function fromStoredRecipe(recipe) {
  return {
    id: recipe.id, title: decodeRecipeText(recipe.title), origin: 'household',
    source: null, notes: null, totalMinutes: null, keyIngredients: [], nutrition: null,
    content: { kind: 'written', ingredients: decodeRecipeText(recipe.ingredients), steps: decodeRecipeText(recipe.steps) },
  };
}

export function decodeDemoRecipe(recipe) {
  const text = decodeRecipeText;
  return {
    ...recipe, title: text(recipe.title), notes: text(recipe.notes),
    source: { ...recipe.source, label: text(recipe.source.label) },
    keyIngredients: recipe.keyIngredients.map(text),
    content: {
      ...recipe.content,
      ingredients: recipe.content.ingredients.map(i => ({ ...i, name: text(i.name), amount: 'text' in i.amount ? { text: text(i.amount.text) } : i.amount })),
      steps: recipe.content.steps.map(s => ({ ...s, instruction: text(s.instruction) })),
    },
  };
}

export function foldText(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function queryLibrary(recipes, { text = '', under30 = false } = {}) {
  const needle = foldText(decodeRecipeText(text).trim());
  const found = recipes.filter(recipe => {
    if (under30 && !(recipe.totalMinutes !== null && recipe.totalMinutes < 30)) return false;
    const ingredients = recipe.content.kind === 'written' ? recipe.content.ingredients : recipe.content.ingredients.map(i => i.name).join(' ');
    return foldText([recipe.title, ingredients, recipe.source?.label, recipe.source?.url].filter(Boolean).join(' ')).includes(needle);
  }).sort((a, b) => collator.compare(a.title.trim(), b.title.trim()) || a.id.localeCompare(b.id));
  const groups = new Map();
  for (const recipe of found) {
    const initial = foldText(recipe.title.trim()).charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(initial) ? initial : '#';
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(recipe);
  }
  return [...groups].sort(([a], [b]) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)).map(([letter, recipes]) => ({ letter, recipes }));
}

const fractions = [[1 / 8, '⅛'], [1 / 6, '⅙'], [1 / 5, '⅕'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [5 / 6, '⅚'], [7 / 8, '⅞']];

export function formatAmount(amount, units, multiplier = 1) {
  if ('text' in amount) return amount.text;
  const { value, unit } = amount[units];
  const scaled = value * multiplier;
  const whole = Math.floor(scaled + 1e-9);
  const remainder = scaled - whole;
  const fraction = units === 'us' && fractions.find(([number]) => Math.abs(number - remainder) < 1e-7);
  const number = fraction ? `${whole || ''}${fraction[1]}` : new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(scaled);
  const label = unit === 'cup' ? (scaled <= 1 + 1e-8 ? 'cup' : 'cups') : unit === 'each' ? '' : unit;
  return `${number}${label ? ` ${label}` : ''}`;
}

export function projectAmounts(content, { servings, units }) {
  const multiplier = servings / content.baseServings;
  const byId = new Map(content.ingredients.map(i => [i.id, i]));
  const row = (ingredient, share = 1) => ({ ingredientId: ingredient.id, name: ingredient.name, amount: formatAmount(ingredient.amount, units, multiplier * share) });
  return {
    ingredients: content.ingredients.map(i => row(i)),
    steps: content.steps.map(step => ({ stepId: step.id, ingredients: step.portions.map(p => row(byId.get(p.ingredientId), p.share)) })),
  };
}

export function validateDemoRecipes(recipes) {
  const ids = new Set();
  for (const recipe of recipes) {
    const content = recipe.content;
    if (ids.has(recipe.id) || recipe.origin !== 'synthetic' || content.kind !== 'linked' || !Number.isInteger(content.baseServings) || content.baseServings < 1) throw new Error(`Invalid demo recipe ${recipe.id}`);
    ids.add(recipe.id);
    const ingredients = new Map(content.ingredients.map(i => [i.id, i]));
    if (ingredients.size !== content.ingredients.length || new Set(content.steps.map(s => s.id)).size !== content.steps.length) throw new Error(`Duplicate ingredient or step in ${recipe.id}`);
    if (!recipe.keyIngredients.length || recipe.keyIngredients.length > 4 || recipe.keyIngredients.some(name => !content.ingredients.some(i => i.name === name))) throw new Error(`Invalid key ingredients in ${recipe.id}`);
    const shares = new Map();
    for (const step of content.steps) for (const portion of step.portions) {
      if (!ingredients.has(portion.ingredientId) || !Number.isFinite(portion.share) || portion.share <= 0 || portion.share > 1) throw new Error(`Invalid portion in ${recipe.id}`);
      shares.set(portion.ingredientId, (shares.get(portion.ingredientId) ?? 0) + portion.share);
    }
    for (const ingredient of content.ingredients) {
      if (Math.abs((shares.get(ingredient.id) ?? 0) - 1) > 1e-8) throw new Error(`Portions must use the total ${recipe.id}/${ingredient.id}`);
      if ('text' in ingredient.amount) continue;
      for (const units of ['us', 'metric']) if (!(ingredient.amount[units]?.value > 0) || !Number.isFinite(ingredient.amount[units].value) || !ingredient.amount[units].unit) throw new Error(`Invalid measure in ${recipe.id}`);
    }
  }
  return recipes;
}
