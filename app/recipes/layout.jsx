import { loadPreviewRecipes } from '../../lib/recipe-demo.server';
import { DemoRecipeProvider } from './recipe-provider';

export default async function RecipesLayout({ children }) {
  const dataset = await loadPreviewRecipes();
  if (dataset) return <DemoRecipeProvider dataset={dataset}>{children}</DemoRecipeProvider>;
  const [{ default: HouseholdGate }, { default: HouseholdRecipeProvider }] = await Promise.all([
    import('./household-gate'), import('./household-recipe-provider'),
  ]);
  return <HouseholdGate><HouseholdRecipeProvider>{children}</HouseholdRecipeProvider></HouseholdGate>;
}
