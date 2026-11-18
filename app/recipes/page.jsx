'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { queryLibrary } from '../../lib/recipe-display';
import { browserRecipeStorage, recentRecipes } from '../../lib/recipe-history';
import { RecipeCommands } from '../site-nav';
import { useRecipeLibrary, useRecipeSource } from './recipe-provider';
import styles from './recipes.module.css';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function LibraryPage() {
  const [query, setQuery] = useState('');
  const [under30, setUnder30] = useState(false);
  const [recent, setRecent] = useState([]);
  const read = useRecipeLibrary();
  const { scope } = useRecipeSource();
  const recipes = read.status === 'ready' ? read.recipes : null;
  useEffect(() => {
    if (!recipes) return;
    const refresh = () => setRecent(recentRecipes(browserRecipeStorage(), scope, recipes));
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [recipes, scope]);
  const groups = queryLibrary(recipes ?? [], { text: query, under30 });
  const letters = groups.map(g => g.letter);
  const recentShown = under30 ? recent.filter(r => r.totalMinutes !== null && r.totalMinutes < 30) : recent;
  const searching = query.trim() !== '';

  return (
    <main className={`${styles.apothecaryPage} ${styles.libraryPage}`}>
      <h1 className={styles.srOnly}>Library</h1>
      <div className={styles.searchRow}>
        <div className={styles.apSearch}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <div className={styles.searchField}><label htmlFor="library-search">What shall we cook?</label><input id="library-search" type="search" aria-label="Search your collection" value={query} onChange={e => setQuery(e.target.value)} placeholder="Titles, ingredients or source…" /></div>
        </div>
        <label className={styles.switchLabel}>
          <input type="checkbox" role="switch" checked={under30} onChange={e => setUnder30(e.target.checked)} />
          <span className={styles.switchTrack} aria-hidden="true" />
          Under 30 minutes
        </label>
      </div>
      <RecipeCommands className={styles.mobileCommands} />
      {!searching ? (
        <details className={styles.recentFlap} open>
          <summary>Recently opened<span className={styles.foldHint} aria-hidden="true" /></summary>
          <div className={styles.recentPaper}>
            {recentShown.length ? recentShown.map(recipe => <Link key={recipe.id} href={`/recipes/${recipe.id}`}>{recipe.title}</Link>)
              : <p>{under30 && recent.length ? 'No recently opened recipes under 30 minutes.' : 'Recipes you open will appear here. Your last five, kept in this browser.'}</p>}
          </div>
        </details>
      ) : null}
      <section aria-label="Recipe library" className={styles.catalog}>
        <p className={styles.srOnly} role="status">{read.status === 'ready' ? `${groups.reduce((sum, g) => sum + g.recipes.length, 0)} recipes` : ''}</p>
        {read.status === 'loading' ? <p role="status">Loading recipe archive...</p> : null}
        {read.status === 'error' ? <p role="alert">Julia could not reach the recipe library. Check the connection and try again.</p> : null}
        {recipes && !groups.length ? <div className={styles.apEmpty}>
          <p>{searching || under30 ? "I couldn't find that in my library." : 'Your library is empty.'}</p>
          <p>{searching || under30 ? 'Try another search or turn off Under 30 minutes.' : 'Add your first recipe with Manual Entry.'}</p>
        </div> : null}
        {groups.map(group => (
          <section key={group.letter} aria-labelledby={`letter-${group.letter}`}>
            <h2 className={styles.letterHeading} id={`letter-${group.letter}`} tabIndex={-1}>{group.letter}</h2>
            <ul className={styles.jarList} aria-label="Recipes">
              {group.recipes.map(recipe => <li key={recipe.id} className={`${styles.cartouche} ${styles.libraryEntry}`}>
                <div className={styles.entryTop}>
                  <Link href={`/recipes/${recipe.id}`} className={styles.entryTitle}>{recipe.title}</Link>
                  {recipe.totalMinutes !== null || recipe.content.kind === 'linked' ? <span className={styles.entryMeta}>
                    {recipe.totalMinutes !== null ? `${recipe.totalMinutes} min` : ''}
                    {recipe.content.kind === 'linked' ? `${recipe.totalMinutes !== null ? ' · ' : ''}serves ${recipe.content.baseServings}` : ''}
                  </span> : null}
                </div>
                <div className={styles.entryBottom}>
                  {recipe.keyIngredients.length ? <span className={styles.keyIngredients}>{recipe.keyIngredients.join(', ')}</span> : <span className={styles.unknownIngredients}>Written household recipe</span>}
                  {recipe.origin === 'synthetic' ? <span className={styles.synthetic}>Synthetic</span> : null}
                </div>
              </li>)}
            </ul>
          </section>
        ))}
      </section>
      <nav aria-label="Jump to recipe letter" className={styles.alphabet}>
        {[...alphabet, ...(letters.includes('#') ? ['#'] : [])].map(letter => letters.includes(letter)
          ? <a key={letter} href={`#letter-${letter}`} aria-label={`Jump to ${letter}`}>{letter}</a>
          : <span key={letter} aria-disabled="true">{letter}</span>)}
      </nav>
      <p className={styles.manualLink}><Link href="/recipes/new">Manual Entry</Link></p>
    </main>
  );
}
