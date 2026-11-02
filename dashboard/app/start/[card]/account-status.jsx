import styles from './start.module.css';

export default function AccountStatus({ accounts }) {
  return <section className={`${styles.section} ${styles.status}`} aria-labelledby="accounts-heading">
    <h2 id="accounts-heading">Accounts</h2>
    {accounts[0] ? <p className={styles.statusReadAt}>Read from each provider when you opened this screen, {accounts[0].readAtText}.</p> : null}
    <ul className={styles.statusList}>{accounts.map(account => <li className={styles.statusItem} key={account.id}>
      <h3 className={styles.statusName}>{account.name}</h3>
      {account.rows.map(row => <p key={row.key} className={`${styles.statusLine} ${row.level === 'out' ? styles.out : row.level === 'nearly-out' ? styles.warn : ''}`}>{row.text}</p>)}
      {account.warning ? <p className={account.level === 'out' ? styles.out : styles.warn}>{account.warning.text}</p> : null}
    </li>)}</ul>
  </section>;
}
