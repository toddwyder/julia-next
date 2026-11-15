import './fonts.css';
import './globals.css';

export const metadata = { title: 'Julia dashboard', description: 'Ready cards in Julia-next' };

export default function Layout({ children }) {
  return <html lang="en"><body><main>{children}</main></body></html>;
}
