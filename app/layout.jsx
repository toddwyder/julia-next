import Image from 'next/image';
import Link from 'next/link';
import localFont from 'next/font/local';

import SiteNav from './site-nav';
import styles from './layout.module.css';
import './vintage.css';

const serif = localFont({
  src: [
    { path: './fonts/playfair-display-latin-wght-normal.woff2', weight: '400 900', style: 'normal' },
    { path: './fonts/playfair-display-latin-wght-italic.woff2', weight: '400 900', style: 'italic' },
  ],
  variable: '--font-serif',
  display: 'swap',
});
const sans = localFont({ src: './fonts/inter-latin-wght-normal.woff2', weight: '100 900', variable: '--font-sans', display: 'swap' });
const mono = localFont({ src: './fonts/roboto-mono-latin-wght-normal.woff2', weight: '100 700', variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Julia',
};

export const viewport = {
  themeColor: '#2D4F36',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
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
