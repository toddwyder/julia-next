'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRecipeDetail } from '../recipe-provider';
import RecipeView from '../recipe-view';
import styles from '../recipes.module.css';

export default function RecipePage({ params }) {
  const { id } = use(params);
  const read = useRecipeDetail(id);
  if (read.status === 'ready') return <RecipeView key={id} recipe={read.recipe} />;
  return <main className={styles.apothecaryPage}>
    {read.status === 'loading' ? <p role="status">Loading recipe archive...</p> : <>
      <p role={read.status === 'error' ? 'alert' : undefined}>{read.status === 'error'
        ? 'Julia could not reach the recipe library. Check the connection and try again.'
        : 'This recipe is not in the household library.'}</p>
      <Link href="/recipes">Back to the Library</Link>
    </>}
  </main>;
}
