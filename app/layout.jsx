import Image from 'next/image';
import Link from 'next/link';
import { Inter, Playfair_Display, Roboto_Mono } from 'next/font/google';

import SiteNav from './site-nav';
import styles from './layout.module.css';
import './vintage.css';

const serif = Playfair_Display({ subsets: ['latin'], weight: ['400', '500', '600', '700'], style: ['normal', 'italic'], variable: '--font-serif' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono' });

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
