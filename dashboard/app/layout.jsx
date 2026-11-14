import { publicSans } from './fonts';
import './globals.css';

export const metadata = { title: 'Julia dashboard', description: 'Ready cards in Julia-next' };

export default function Layout({ children }) {
  return <html lang="en" className={publicSans.variable}><body><main>{children}</main></body></html>;
}
