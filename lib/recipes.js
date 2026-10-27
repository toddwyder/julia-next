import { collection, doc, getDoc, getDocs, orderBy, query, runTransaction } from 'firebase/firestore';

// The household library is one Firestore document per recipe at recipes/{id}.
// Text is stored exactly as it was written and never trimmed, split or reflowed.

// Where recipes lived before sign-in: one JSON document in this browser.
export const LIBRARY_KEY = 'julia.recipes.v1';
export const LIBRARY_VERSION = 1;

/**
 * @typedef {{ id: string, title: string, ingredients: string, steps: string, createdAt: string }} Recipe
 * @typedef {import('firebase/firestore').Firestore} Firestore
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
 * @param {unknown} value
 * @param {string} field
 */
function assertText(value, field) {
  if (typeof value !== 'string') throw new Error(`A recipe ${field} must be text.`);
}

/**
 * Stores a recipe under `id`, or returns the recipe already stored there. The
 * check and the write are one transaction, so a double tap, or a retry after a
 * connection dropped mid-save, leaves exactly one complete recipe.
 * @param {Firestore} db
 * @param {string} id
 * @param {{ title?: unknown, ingredients?: unknown, steps?: unknown }} fields
 * @param {string} [createdAt]
 * @returns {Promise<Recipe>}
 */
export async function saveRecipe(db, id, { title, ingredients, steps } = {}, createdAt = new Date().toISOString()) {
  assertText(id, 'id');
  if (id === '') throw new Error('A recipe needs an id.');
  assertText(title, 'title');
  assertText(ingredients, 'ingredients');
  assertText(steps, 'steps');
  if (title.trim() === '') throw new Error('A recipe needs a title.');
  const ref = doc(db, 'recipes', id);
  return runTransaction(db, async transaction => {
    const stored = await transaction.get(ref);
    if (stored.exists()) return /** @type {Recipe} */ (stored.data());
    const recipe = { id, title, ingredients, steps, createdAt };
    transaction.set(ref, recipe);
    return recipe;
  });
}

/**
 * Recipes newest first. `search` matches any part of a title, ignoring case;
 * an empty or whitespace-only search returns everything.
 * @param {Firestore} db
 * @param {string} [search]
 * @returns {Promise<Recipe[]>}
 */
export async function listRecipes(db, search = '') {
  const needle = String(search).trim().toLowerCase();
  const snapshot = await getDocs(query(collection(db, 'recipes'), orderBy('createdAt', 'desc')));
  const recipes = snapshot.docs.map(stored => /** @type {Recipe} */ (stored.data()));
  if (needle === '') return recipes;
  return recipes.filter(recipe => recipe.title.toLowerCase().includes(needle));
}

/**
 * @param {Firestore} db
 * @param {string} id
 * @returns {Promise<Recipe | null>}
 */
export async function getRecipe(db, id) {
  const stored = await getDoc(doc(db, 'recipes', id));
  return stored.exists() ? /** @type {Recipe} */ (stored.data()) : null;
}

/**
 * Reads the recipes this browser kept before sign-in. Unreadable or unknown
 * data throws: a caller that cannot understand what is on the device must
 * never remove it.
 * @param {{ getItem: (key: string) => string | null }} storage
 * @returns {Recipe[]}
 */
export function readBrowserRecipes(storage) {
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
 * Moves this browser's recipes into the household library, then removes them
 * from the browser. Each recipe keeps its id, so a move that is interrupted and
 * run again, or run from two tabs at once, stores each recipe once.
 * @param {Firestore} db
 * @param {{ getItem: (key: string) => string | null, removeItem: (key: string) => void }} storage
 * @returns {Promise<number>} how many recipes this browser held
 */
export async function moveBrowserRecipes(db, storage) {
  const recipes = readBrowserRecipes(storage);
  for (const recipe of recipes) await saveRecipe(db, recipe.id, recipe, recipe.createdAt);
  storage.removeItem(LIBRARY_KEY);
  return recipes.length;
}

/** @returns {string} */
export function newRecipeId() {
  return globalThis.crypto.randomUUID();
}
