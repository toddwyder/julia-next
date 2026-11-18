'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import styles from './recipes.module.css';

export const RecipeSource = createContext(null);
export const useRecipeSource = () => useContext(RecipeSource);

export function DemoRecipeProvider({ dataset, children }) {
  const pathname = usePathname();
  return (
    <RecipeSource.Provider value={{ catalog: dataset.recipes, scope: `demo:${dataset.id}` }}>
      {pathname === '/recipes/new' ? (
        <main className={styles.apothecaryPage}>
          <h1 className={styles.displayHeading}>Preview only</h1>
          <p>This synthetic library is read-only. Manual Entry and saving are available in the household library.</p>
          <Link href="/recipes">Back to the Library</Link>
        </main>
      ) : children}
    </RecipeSource.Provider>
  );
}

export function useRecipeLibrary() {
  const source = useRecipeSource();
  const [read, setRead] = useState({ status: 'loading' });
  useEffect(() => {
    if (source.catalog) return;
    let current = true;
    source.loadLibrary().then(
      recipes => { if (current) setRead({ status: 'ready', recipes }); },
      () => { if (current) setRead({ status: 'error' }); },
    );
    return () => { current = false; };
  }, [source]);
  return source.catalog ? { status: 'ready', recipes: source.catalog } : read;
}

export function useRecipeDetail(id) {
  const source = useRecipeSource();
  const [read, setRead] = useState({ status: 'loading' });
  useEffect(() => {
    if (source.catalog) return;
    let current = true;
    source.loadRecipe(id).then(
      recipe => { if (current) setRead({ id, status: recipe ? 'ready' : 'missing', recipe }); },
      () => { if (current) setRead({ id, status: 'error' }); },
    );
    return () => { current = false; };
  }, [source, id]);
  if (source.catalog) {
    const recipe = source.catalog.find(r => r.id === id);
    return { status: recipe ? 'ready' : 'missing', recipe };
  }
  return read.id === id ? read : { status: 'loading' };
}
