import styles from './practice.module.css';

export default function PracticePage() {
  return (
    <main className={`vintage-column ${styles.page}`}>
      <h1 className={styles.heading}>The Kitchen</h1>
      <p className={styles.line}>This page is a practice fixture so there is a plain room in the cookbook to stand in.</p>
    </main>
  );
}
