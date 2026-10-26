'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { openRecipeLibrary } from '../../../lib/recipes';
import styles from '../recipes.module.css';

export default function RecipePage({ params }) {
  const { id } = use(params);
  const [read, setRead] = useState({ status: 'reading', recipe: null, error: '' });

  useEffect(() => {
    try {
      const recipe = openRecipeLibrary(window.localStorage).get(id);
      setRead({ status: recipe ? 'stored' : 'missing', recipe, error: '' });
    } catch (thrown) {
      setRead({ status: 'missing', recipe: null, error: thrown.message });
    }
  }, [id]);

  if (read.status === 'reading') {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <p className={styles.empty}>Opening the recipe…</p>
        </div>
      </main>
    );
  }

  if (read.status === 'missing') {
    return (
      <main className={styles.page}>
        <div className={styles.sheet}>
          <p className={styles.empty}>This recipe is not on this device.</p>
          {read.error ? <p className={styles.error} role="alert">{read.error}</p> : null}
          <Link href="/recipes" className={styles.action}>Back to the Library</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>From the Library</p>
        <h1 className={styles.title} data-testid="recipe-title">{read.recipe.title}</h1>

        <h2 className={styles.subheading}>The Ingredients</h2>
        <p className={styles.prose} data-testid="recipe-ingredients">{read.recipe.ingredients}</p>

        <h2 className={styles.subheading}>Preparation</h2>
        <p className={styles.prose} data-testid="recipe-steps">{read.recipe.steps}</p>

        <Link href="/recipes" className={styles.action}>Back to the Library</Link>
      </div>
    </main>
  );
}
