'use client';

import { useMemo } from 'react';
import { getRecipe, listRecipes } from '../../lib/recipes';
import { fromStoredRecipe } from '../../lib/recipe-display';
import { useHousehold } from './household-gate';
import { RecipeSource } from './recipe-provider';

export default function HouseholdRecipeProvider({ children }) {
  const { db, user } = useHousehold();
  const source = useMemo(() => ({
    scope: `household:${db.app.options.projectId}:${user.uid}`,
    loadLibrary: async () => (await listRecipes(db)).map(fromStoredRecipe),
    loadRecipe: async id => {
      const stored = await getRecipe(db, id);
      return stored ? fromStoredRecipe(stored) : null;
    },
  }), [db, user.uid]);
  return <RecipeSource.Provider value={source}>{children}</RecipeSource.Provider>;
}
