import 'server-only';
import { recipePreviewEnabled } from './recipe-preview-mode';

export async function loadPreviewRecipes() {
  if (!recipePreviewEnabled(process.env)) return null;
  const { demoRecipes, datasetId } = await import('./recipe-demo-data.js');
  const { validateDemoRecipes, decodeDemoRecipe } = await import('./recipe-display.js');
  return { id: datasetId, recipes: validateDemoRecipes(demoRecipes).map(decodeDemoRecipe) };
}
