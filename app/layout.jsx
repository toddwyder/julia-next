import Link from 'next/link';

import styles from './layout.module.css';

export const metadata = {
  title: 'Julia',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="Main" className={styles.nav}>
          <Link href="/" className={styles.link}>Julia</Link>
          <Link href="/recipes" className={styles.link}>Library</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
