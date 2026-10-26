import { version } from '../package.json';
import styles from './page.module.css';

export default function Page() {
  return (
    <main className={`vintage-column ${styles.home}`}>
      <div>Julia {version}</div>
      <p>what are we cooking today?</p>
    </main>
  );
}
