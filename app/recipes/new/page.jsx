'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { newRecipeId, openRecipeLibrary } from '../../../lib/recipes';
import styles from '../recipes.module.css';

export default function NewRecipePage() {
  const router = useRouter();
  const [id] = useState(() => newRecipeId());
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    const written = new FormData(event.currentTarget);
    try {
      openRecipeLibrary(window.localStorage).save(id, {
        title: written.get('title'),
        ingredients: written.get('ingredients'),
        steps: written.get('steps'),
      });
    } catch (thrown) {
      setError(thrown.message);
      return;
    }
    router.replace(`/recipes/${id}`);
  }

  return (
    <main className={`vintage-column ${styles.page}`}>
      <form onSubmit={handleSubmit} noValidate className={styles.stack}>
        <h1 className={styles.title}>Enter a Recipe</h1>
        <p className={styles.subtitle}>❧ Enter recipe details below to save it manually to your vintage cookbook collection.</p>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Recipe Info</h2>
          <div>
            <label className={styles.label} htmlFor="recipe-title">Recipe Title</label>
            <input id="recipe-title" name="title" type="text" className={styles.input} autoComplete="off" placeholder="e.g. Classic Margherita Pizza" />
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading} id="recipe-ingredients-heading">Ingredients</h2>
          <p className={styles.helper}>❧ Type ingredients freely (one ingredient per line, e.g., 1 c shredded mozzarella).</p>
          <textarea name="ingredients" aria-labelledby="recipe-ingredients-heading" className={styles.textarea} defaultValue="" placeholder="e.g. 1 c shredded mozzarella 3 fresh basil leaves" />
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading} id="recipe-steps-heading">Instructions</h2>
          <p className={styles.helper}>❧ Type instructions freely (each line represents a step).</p>
          <textarea name="steps" aria-labelledby="recipe-steps-heading" className={styles.textarea} defaultValue="" placeholder="e.g. Preheat oven to 450 degrees. Spread tomato sauce over raw dough." />
        </section>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.formActions}>
          <Link href="/recipes" className={styles.outline}>Cancel</Link>
          <button type="submit" className={styles.solid}>Save Recipe</button>
        </div>

        <p className={styles.notice}>❧ Recipes are saved only in this browser on this device.</p>
      </form>
    </main>
  );
}
