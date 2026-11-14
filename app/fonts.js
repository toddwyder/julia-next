import localFont from 'next/font/local';

export const playfairDisplay = localFont({
  src: [
    { path: './fonts/playfair-display/playfair-display-latin-wght-normal.woff2', weight: '400 900', style: 'normal' },
    { path: './fonts/playfair-display/playfair-display-latin-wght-italic.woff2', weight: '400 900', style: 'italic' },
  ],
  adjustFontFallback: 'Times New Roman',
  variable: '--font-serif',
});

export const inter = localFont({
  src: './fonts/inter/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-sans',
});

export const robotoMono = localFont({
  src: './fonts/roboto-mono/roboto-mono-latin-wght-normal.woff2',
  weight: '100 700',
  variable: '--font-mono',
});
