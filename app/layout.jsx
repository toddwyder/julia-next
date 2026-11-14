import Image from 'next/image';
import Link from 'next/link';

import { inter, playfairDisplay, robotoMono } from './fonts';
import SiteNav from './site-nav';
import styles from './layout.module.css';
import './vintage.css';

export const metadata = {
  title: 'Julia',
};

export const viewport = {
  themeColor: '#2D4F36',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${playfairDisplay.variable} ${inter.variable} ${robotoMono.variable}`}>
      <body>
        <header className={`vintage-column ${styles.masthead}`}>
          <Link href="/" className={styles.logo}>
            <Image src="/assets/vintage-logo.png" alt="Julia" width={144} height={70} priority />
          </Link>
          <p className={styles.cookbook}>❧ The Julia Cookbook ☙</p>
          <p className={styles.established}>established 1961</p>
          <span className={styles.flourish} aria-hidden="true" />
        </header>
        <div className="vintage-column">
          <SiteNav />
        </div>
        {children}
      </body>
    </html>
  );
}
