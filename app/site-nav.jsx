'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import vintage from './layout.module.css';
import styles from './apothecary.module.css';

const destinations = ['Library', 'Lab', 'Menus', 'Prep List', 'Shopping List'];

export function RecipeCommands({ className = '' }) {
  const [notice, setNotice] = useState(false);
  return (
    <div className={`${styles.commands} ${className}`}>
      <button type="button" className={styles.importButton} onClick={() => setNotice(!notice)} aria-expanded={notice}>Import</button>
      <Link href="/recipes/new" className={styles.addButton}>Add recipe</Link>
      {notice ? <p className={styles.commandNotice} role="status">Import is unavailable. Use Add recipe for Manual Entry in the household library.</p> : null}
    </div>
  );
}

export default function SiteNav({ children }) {
  const pathname = usePathname();
  const [notice, setNotice] = useState('');
  const recipes = pathname === '/recipes' || pathname.startsWith('/recipes/');
  if (!recipes) return (
    <>
      <header className={`vintage-column ${vintage.masthead}`}>
        <Link href="/" className={vintage.logo}><Image src="/assets/vintage-logo.png" alt="Julia" width={144} height={70} priority /></Link>
        <p className={vintage.cookbook}>❧ The Julia Cookbook ☙</p>
        <p className={vintage.established}>established 1961</p>
        <span className={vintage.flourish} aria-hidden="true" />
      </header>
      <div className="vintage-column"><nav aria-label="Main" className={vintage.nav}><Link href="/recipes" className={vintage.tab}>Library</Link></nav></div>
      {children}
    </>
  );
  return (
    <div className={styles.shell}>
      <header className={styles.masthead}>
        <Link href="/" className={styles.logo}><Image src="/apothecary/julia-logo.png" alt="Julia" width={770} height={244} priority /></Link>
        <nav aria-label="Main" className={styles.nav}>
          {destinations.map(label => label === 'Library'
            ? <Link key={label} href="/recipes" className={styles.active} aria-current="page">Library</Link>
            : <button key={label} type="button" aria-disabled="true" title={`${label} is not available yet.`} onClick={() => setNotice(`${label} is not available yet.`)}>{label}</button>)}
        </nav>
        <RecipeCommands className={styles.desktopCommands} />
      </header>
      {notice ? <div role="status" className={styles.navNotice}><span>{notice}</span><button type="button" onClick={() => setNotice('')}>Dismiss</button></div> : null}
      {children}
    </div>
  );
}
