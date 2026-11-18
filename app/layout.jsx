import { IM_Fell_English, Libre_Caslon_Text, Inter, Playfair_Display, Roboto_Mono } from 'next/font/google';

import SiteNav from './site-nav';
import './vintage.css';

const serif = Playfair_Display({ subsets: ['latin'], weight: ['400', '500', '600', '700'], style: ['normal', 'italic'], variable: '--font-serif' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono' });

const display = IM_Fell_English({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-apothecary-display' });
const reading = Libre_Caslon_Text({ subsets: ['latin'], weight: ['400', '700'], style: ['normal', 'italic'], variable: '--font-apothecary-reading' });

export const metadata = {
  title: 'Julia',
  icons: { icon: '/apothecary/julia-tab-icon.png' },
};

export const viewport = {
  themeColor: '#2D4F36',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} ${display.variable} ${reading.variable}`}>
      <body>
        <SiteNav>{children}</SiteNav>
      </body>
    </html>
  );
}
