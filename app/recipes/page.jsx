'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { listRecipes } from '../../lib/recipes';
import { useHousehold } from './household-gate';
import styles from './recipes.module.css';

export default function LibraryPage() {
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState('');
  const { db } = useHousehold();

  useEffect(() => {
    let current = true;
    listRecipes(db, query).then(
      found => { if (current) { setRecipes(found); setError(''); } },
      () => { if (current) { setRecipes([]); setError('Julia could not reach the recipe library. Check the connection and try again.'); } },
    );
    return () => { current = false; };
  }, [db, query]);

  const searching = query.trim() !== '';

  return (
    <main className={`vintage-column ${styles.page}`}>
      <div className={styles.stack}>
        <h1 className={styles.title}>Library</h1>

        <div className={styles.libraryActions}>
          <Link href="/recipes/new" className={styles.outline}>Manual Entry</Link>
        </div>

        <div className={styles.searchBox}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search your collection"
            className={styles.input}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search your collection (e.g. Coq au Vin, Chicken)..."
          />
        </div>

        <section>
          <h2 className={styles.sectionHeading}>Recipes</h2>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {recipes === null ? <p className={styles.loading}>Loading recipe archive...</p> : null}
          {recipes !== null && recipes.length === 0 && !error
            ? (
              <div className={styles.emptyBox}>
                <p className={styles.emptyHeading}>
                  {searching ? "I couldn't find that in my library." : 'Your library is empty.'}
                </p>
                <p className={styles.emptyLine}>
                  {searching ? "Let's adjust the seasoning and try something else." : 'Add your first recipe with Manual Entry.'}
                </p>
              </div>
            )
            : null}

          <ul className={styles.list} aria-label="Recipes">
            {(recipes ?? []).map(recipe => (
              <li key={recipe.id} className={styles.row}>
                <Link href={`/recipes/${recipe.id}`} className={styles.recipeLink}>{recipe.title}</Link>
              </li>
            ))}
          </ul>
        </section>

      </div>
    </main>
  );
}
