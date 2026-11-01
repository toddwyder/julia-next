'use client';

import { useEffect, useState } from 'react';

import { listRecipes } from '../../lib/recipes';
import { useHousehold } from '../recipes/household-gate';
import page from '../recipes/recipes.module.css';
import styles from './kitchen-count.module.css';

export default function KitchenCountPage() {
  const [count, setCount] = useState(null);
  const [error, setError] = useState('');
  const { db } = useHousehold();

  useEffect(() => {
    let current = true;
    listRecipes(db).then(
      recipes => { if (current) { setCount(recipes.length); setError(''); } },
      () => { if (current) { setCount(null); setError('Julia could not reach the recipe library. Check the connection and try again.'); } },
    );
    return () => { current = false; };
  }, [db]);

  return (
    <main className={`vintage-column ${page.page}`}>
      <div className={page.stack}>
        <h1 className={page.title}>The kitchen count</h1>
        {error ? <p className={page.error} role="alert">{error}</p> : null}
        {count === null && !error ? <p className={page.loading}>Counting the recipe archive...</p> : null}
        {count !== null ? <p className={styles.count}>{count}</p> : null}
      </div>
    </main>
  );
}
