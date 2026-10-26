'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './layout.module.css';

// Only built screens get a tab; Lab, Shopping List, Menus and Prep List join as they ship.
const TABS = [{ href: '/recipes', label: 'Library' }];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={styles.nav}>
      {TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={pathname === href ? `${styles.tab} ${styles.active}` : styles.tab}
          aria-current={pathname === href ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
