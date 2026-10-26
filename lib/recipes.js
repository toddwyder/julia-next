// One JSON document under one key, so a save is a single write and a reload
// always sees either the old library or the new one. Text is stored exactly as
// it was written and never trimmed, split or reflowed.

export const LIBRARY_KEY = 'julia.recipes.v1';
export const LIBRARY_VERSION = 1;

/**
 * @typedef {{ id: string, title: string, ingredients: string, steps: string, createdAt: string }} Recipe
 */

/** @param {unknown} value */
function isRecipe(value) {
  return Boolean(value) && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.ingredients === 'string'
    && typeof value.steps === 'string'
    && typeof value.createdAt === 'string';
}

/**
 * Reads the stored library. Unreadable or unknown data throws: a caller that
 * cannot understand what is on the device must never replace it.
 * @param {{ getItem: (key: string) => string | null }} storage
 * @returns {Recipe[]}
 */
function readRecipes(storage) {
  const stored = storage.getItem(LIBRARY_KEY);
  if (stored === null || stored === undefined) return [];
  let document;
  try {
    document = JSON.parse(stored);
  } catch {
    throw new Error(`${LIBRARY_KEY} does not hold readable JSON, so it was left untouched.`);
  }
  if (!document || typeof document !== 'object' || document.version !== LIBRARY_VERSION
    || !Array.isArray(document.recipes) || !document.recipes.every(isRecipe)) {
    throw new Error(`${LIBRARY_KEY} does not hold a version ${LIBRARY_VERSION} recipe library, so it was left untouched.`);
  }
  return document.recipes;
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function assertText(value, field) {
  if (typeof value !== 'string') throw new Error(`A recipe ${field} must be text.`);
}

/**
 * The whole recipe store. `storage` is the browser's own Storage object in the
 * app, so nothing leaves the device.
 * @param {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} storage
 */
export function openRecipeLibrary(storage) {
  return {
    /**
     * Stores a recipe under `id`. Saving the same id twice returns the stored
     * recipe unchanged, so a double Save is one recipe.
     * @param {string} id
     * @param {{ title?: unknown, ingredients?: unknown, steps?: unknown }} fields
     * @returns {Recipe}
     */
    save(id, { title, ingredients, steps } = {}) {
      assertText(id, 'id');
      if (id === '') throw new Error('A recipe needs an id.');
      assertText(title, 'title');
      assertText(ingredients, 'ingredients');
      assertText(steps, 'steps');
      if (title.trim() === '') throw new Error('A recipe needs a title.');
      const recipes = readRecipes(storage);
      const stored = recipes.find(recipe => recipe.id === id);
      if (stored) return stored;
      const recipe = { id, title, ingredients, steps, createdAt: new Date().toISOString() };
      storage.setItem(LIBRARY_KEY, JSON.stringify({ version: LIBRARY_VERSION, recipes: [recipe, ...recipes] }));
      return recipe;
    },

    /**
     * Recipes newest first. `query` matches any part of a title, ignoring case;
     * an empty or whitespace-only query returns everything.
     * @param {string} [query]
     * @returns {Recipe[]}
     */
    list(query = '') {
      const needle = String(query).trim().toLowerCase();
      const recipes = readRecipes(storage);
      if (needle === '') return recipes;
      return recipes.filter(recipe => recipe.title.toLowerCase().includes(needle));
    },

    /**
     * @param {string} id
     * @returns {Recipe | null}
     */
    get(id) {
      return readRecipes(storage).find(recipe => recipe.id === id) ?? null;
    },
  };
}

/** @returns {string} */
export function newRecipeId() {
  return globalThis.crypto.randomUUID();
}
