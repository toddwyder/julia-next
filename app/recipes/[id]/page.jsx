'use client';

import { Fragment, use, useEffect, useState } from 'react';
import Link from 'next/link';

import { getRecipe } from '../../../lib/recipes';
import { useHousehold } from '../household-gate';
import styles from '../recipes.module.css';

// One row per written line, joined by the original newlines, so the element's
// textContent is still exactly what was typed.
function WrittenLines({ text, rowClass }) {
  return text.split('\n').map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? '\n' : null}
      <span className={line === '' ? styles.blankLine : rowClass}>{line}</span>
    </Fragment>
  ));
}

export default function RecipePage({ params }) {
  const { id } = use(params);
  const [read, setRead] = useState({ status: 'reading', recipe: null, error: '' });
  const { db } = useHousehold();

  useEffect(() => {
    let current = true;
    getRecipe(db, id).then(
      recipe => { if (current) setRead({ status: recipe ? 'stored' : 'missing', recipe, error: '' }); },
      () => { if (current) setRead({ status: 'missing', recipe: null, error: 'Julia could not reach the recipe library. Check the connection and try again.' }); },
    );
    return () => { current = false; };
  }, [db, id]);

  if (read.status === 'reading') {
    return (
      <main className={`vintage-column ${styles.page}`}>
        <p className={styles.loading}>Loading recipe archive...</p>
      </main>
    );
  }

  if (read.status === 'missing') {
    return (
      <main className={`vintage-column ${styles.page}`}>
        <div className={styles.stack}>
          <div className={styles.emptyBox}>
            <p className={styles.emptyHeading}>This recipe is not in the household library.</p>
          </div>
          {read.error ? <p className={styles.error} role="alert">{read.error}</p> : null}
          <div>
            <Link href="/recipes" className={styles.typewriter}>← Back to the Library</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`vintage-column ${styles.page}`}>
      <article className={styles.stack}>
        <h1 className={styles.recipeTitle} data-testid="recipe-title">{read.recipe.title}</h1>

        <div className={styles.band}>
          <Link href="/recipes" className={styles.typewriter}>← Library</Link>
        </div>

        <section className={styles.section}>
          <h2 className={styles.recipeHeading}>The Ingredients</h2>
          <div className={styles.ingredients} data-testid="recipe-ingredients">
            <WrittenLines text={read.recipe.ingredients} rowClass={styles.ingredient} />
          </div>
        </section>

        <hr className={styles.divider} />

        <section className={styles.section}>
          <h2 className={styles.recipeHeading}>Preparation</h2>
          <div className={styles.steps} data-testid="recipe-steps">
            <WrittenLines text={read.recipe.steps} rowClass={styles.step} />
          </div>
        </section>
      </article>
    </main>
  );
}
