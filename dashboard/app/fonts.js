import localFont from 'next/font/local';

export const publicSans = localFont({
  src: './fonts/public-sans/public-sans-latin-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-public-sans',
});
