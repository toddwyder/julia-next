import { Public_Sans } from 'next/font/google';
import './globals.css';

const publicSans = Public_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-public-sans' });
export const metadata = { title: 'Julia dashboard', description: 'Ready cards in Julia-next' };

export default function Layout({ children }) {
  return <html lang="en" className={publicSans.variable}><body><main>{children}</main></body></html>;
}
