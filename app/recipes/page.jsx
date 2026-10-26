'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { openRecipeLibrary } from '../../lib/recipes';
import styles from './recipes.module.css';

export default function LibraryPage() {
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      setRecipes(openRecipeLibrary(window.localStorage).list(query));
      setError('');
    } catch (thrown) {
      setRecipes([]);
      setError(thrown.message);
    }
  }, [query]);

  const searching = query.trim() !== '';

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>The Julia cookbook</p>
        <h1 className={styles.heading}>Library</h1>
        <Link href="/recipes/new" className={styles.action}>Manual Entry</Link>

        <div className={styles.fieldGroup}>
          <label className={styles.field} htmlFor="recipe-search">Search your collection</label>
          <input
            id="recipe-search"
            type="search"
            className={styles.search}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="e.g. Coq au Vin, Chicken"
          />
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {recipes === null ? <p className={styles.empty}>Loading your collection…</p> : null}
        {recipes !== null && recipes.length === 0 && !error
          ? (
            <p className={styles.empty}>
              {searching ? 'No recipe title matches that search.' : 'Nothing here yet. Add your first recipe with Manual Entry.'}
            </p>
          )
          : null}

        <ul className={styles.list} aria-label="Recipes">
          {(recipes ?? []).map(recipe => (
            <li key={recipe.id} className={styles.listItem}>
              <Link href={`/recipes/${recipe.id}`} className={styles.recipeLink}>{recipe.title}</Link>
            </li>
          ))}
        </ul>

        <p className={styles.notice}>Recipes are saved only in this browser on this device.</p>
      </div>
    </main>
  );
}
