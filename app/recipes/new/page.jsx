'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { newRecipeId, saveRecipe } from '../../../lib/recipes';
import { errorCode, reportRecipeEvent } from '../../../lib/report-recipe-event';
import { useHousehold } from '../household-gate';
import styles from '../recipes.module.css';

export default function NewRecipePage() {
  const router = useRouter();
  const [id] = useState(() => newRecipeId());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { db, user } = useHousehold();

  // The id is fixed when the page opens, so pressing Save again after a failed
  // or unanswered save finds the recipe already stored instead of adding one.
  async function handleSubmit(event) {
    event.preventDefault();
    const written = new FormData(event.currentTarget);
    const fields = { title: written.get('title'), ingredients: written.get('ingredients'), steps: written.get('steps') };
    if (String(fields.title).trim() === '') {
      setError('A recipe needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveRecipe(db, id, fields);
    } catch (thrown) {
      reportRecipeEvent(user, { action: 'save', outcome: 'failed', code: errorCode(thrown) });
      setError('Julia could not save this recipe. Nothing is lost: check the connection and press Save Recipe again.');
      setSaving(false);
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
          <button type="submit" className={styles.solid} disabled={saving}>{saving ? 'Saving...' : 'Save Recipe'}</button>
        </div>

      </form>
    </main>
  );
}
