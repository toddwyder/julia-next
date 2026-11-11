import localFont from 'next/font/local';
import './globals.css';

const publicSans = localFont({ src: './fonts/public-sans-latin-wght-normal.woff2', weight: '100 900', display: 'swap', variable: '--font-public-sans' });
export const metadata = { title: 'Julia dashboard', description: 'Ready cards in Julia-next' };

export default function Layout({ children }) {
  return <html lang="en" className={publicSans.variable}><body><main>{children}</main></body></html>;
}
