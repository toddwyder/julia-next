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
    <main className={styles.page}>
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>The Julia cookbook</p>
        <h1 className={styles.heading}>Enter a Recipe</h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label className={styles.field} htmlFor="recipe-title">Recipe Title</label>
            <input id="recipe-title" name="title" type="text" className={styles.input} autoComplete="off" />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.field} htmlFor="recipe-ingredients">Ingredients</label>
            <textarea id="recipe-ingredients" name="ingredients" className={styles.textarea} defaultValue="" />
            <p className={styles.hint}>one ingredient per line</p>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.field} htmlFor="recipe-steps">Instructions</label>
            <textarea id="recipe-steps" name="steps" className={styles.textarea} defaultValue="" />
            <p className={styles.hint}>each line represents a step</p>
          </div>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <div className={styles.buttons}>
            <button type="submit" className={styles.submit}>Save Recipe</button>
            <Link href="/recipes" className={styles.action}>Cancel</Link>
          </div>
        </form>

        <p className={styles.notice}>Recipes are saved only in this browser on this device.</p>
      </div>
    </main>
  );
}
