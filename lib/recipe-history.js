const prefix = 'julia.recipe-ui.v1';
const key = (scope, kind, id) => `${prefix}:${encodeURIComponent(scope)}:${kind}:${encodeURIComponent(id)}`;

function read(storage, name) {
  try {
    const value = JSON.parse(storage.getItem(name));
    return value?.version === 1 ? value : null;
  } catch { return null; }
}

function write(storage, name, value) {
  try { storage.setItem(name, JSON.stringify({ version: 1, ...value })); } catch { /* Storage may be denied while recipes remain readable. */ }
}

export function markOpened(storage, scope, id, now = Date.now()) {
  write(storage, key(scope, 'opened', id), { openedAt: now });
}

export function recentRecipes(storage, scope, recipes) {
  return recipes.map(recipe => ({ recipe, time: read(storage, key(scope, 'opened', recipe.id))?.openedAt }))
    .filter(({ time }) => Number.isFinite(time) && time > 0)
    .sort((a, b) => b.time - a.time || a.recipe.id.localeCompare(b.recipe.id))
    .slice(0, 5).map(({ recipe }) => recipe);
}

export function readLastStep(storage, scope, recipe) {
  const stepId = read(storage, key(scope, 'step', recipe.id))?.stepId;
  return recipe.content.kind === 'linked' && recipe.content.steps.some(s => s.id === stepId) ? stepId : null;
}

export function markLastStep(storage, scope, id, stepId) {
  write(storage, key(scope, 'step', id), { stepId });
}

export function browserRecipeStorage() {
  try { return window.localStorage; } catch { return { getItem: () => null, setItem: () => {} }; }
}
