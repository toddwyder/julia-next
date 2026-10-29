import { connection } from 'next/server';
import { getReadyCard } from '../../../lib/linear.js';
import { priceLabel, readModels, startModels } from '../../../lib/models.js';
import styles from './start.module.css';

const EFFORTS = [
  { id: 'small', name: 'Small', brains: 1 },
  { id: 'medium', name: 'Medium', brains: 2 },
  { id: 'large', name: 'Large', brains: 3 },
  { id: 'unlimited', name: 'Unlimited', brains: 4 },
];

const EXPLANATION = 'How hard the models think. More brains is slower and costs more.';
const SWEEP_MISSING = 'No model sweep has run yet, so there are no models or prices to show. Go back to the list and open this card again after the weekly sweep.';
const UNPRICED_MISSING = 'The sweep has saved no model with a price, so this screen has nothing to show. Go back to the list and open this card again after the next sweep.';

function sweepDay(date) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function ModelLine({ model }) {
  return <dd><span className={styles.model}>{model.displayName}</span> <span className={styles.price}>{priceLabel(model)}</span></dd>;
}

export default async function StartPage({ params }) {
  await connection();
  const { card: identifier } = await params;
  let card;
  let failure;
  try { card = await getReadyCard(identifier); }
  catch (error) {
    console.error(`julia-dashboard: Start screen failed for ${String(identifier).slice(0, 40).replace(/[^\w-]/g, '')}:`, error);
    failure = error.message;
  }

  let saved;
  let modelsProblem;
  if (card) {
    try { saved = readModels(); }
    catch (error) {
      console.error(`julia-dashboard: saved model list failed to read for ${String(identifier).slice(0, 40).replace(/[^\w-]/g, '')}:`, error);
      modelsProblem = 'The saved model list could not be read. Go back to the list and try again.';
    }
  }
  const picked = saved ? startModels(saved) : null;

  return <><a className="back" href="/">← Back to Ready cards</a>
    <header><p className="eyebrow">Start screen</p>
      <p className="identifier">{identifier}</p><h1>{card ? card.title : 'Card unavailable'}</h1></header>
    {failure ? <p className="problem" role="alert">{failure}</p>
      : !card ? <p className="empty">This card is not in Julia-next Ready. Go Back to choose a Ready card.</p>
      : modelsProblem ? <p className="problem" role="alert">{modelsProblem}</p>
      : saved.status === 'missing' || saved.status === 'empty' ? <p className="empty">{SWEEP_MISSING}</p>
      : !picked.mainSession || !picked.shipping ? <p className="empty">{UNPRICED_MISSING}</p>
      : <div className={styles.screen}>
        {saved.status === 'stale' ? <p className={styles.stale} role="status">
          The last sweep was on {sweepDay(saved.sweptAt)}. That is more than eight days ago. Run the weekly sweep to refresh these prices.
        </p> : null}
        <section className={styles.section} aria-labelledby="settings-heading">
          <h2 id="settings-heading">Settings</h2>
          <dl className={styles.summary}>
            <div className={styles.row}><dt>Main session</dt><ModelLine model={picked.mainSession} /></div>
            <div className={styles.row}><dt>Shipping</dt><ModelLine model={picked.shipping} /></div>
            <div className={styles.row}><dt>Effort</dt><dd>{EFFORTS.find(effort => effort.id === picked.effort)?.name ?? 'Large'}</dd></div>
          </dl>
        </section>
        <section className={styles.section} aria-labelledby="effort-heading">
          <h2 id="effort-heading">Effort</h2>
          <ul className={styles.efforts}>
            {EFFORTS.map(effort => <li key={effort.id} className={effort.id === picked.effort ? `${styles.effort} ${styles.chosen}` : styles.effort} aria-current={effort.id === picked.effort ? 'true' : undefined}>
              <span className={styles.brains} aria-hidden="true">{'🧠'.repeat(effort.brains)}</span>
              <span className={styles.effortName}>{effort.name}</span>
            </li>)}
          </ul>
          <details className={styles.why}><summary className={styles.whyLabel}>What effort means</summary>
            <p>{EXPLANATION}</p></details>
        </section>
        <section className={styles.section} aria-labelledby="prices-heading">
          <h2 id="prices-heading">Prices</h2>
          <p className={styles.sources}>Prices paid per million tokens. ↓ is what you are charged for what you send, ↑ for what the model writes. Read from each provider&apos;s pricing page on {sweepDay(saved.sweptAt)}.</p>
          <ul className={styles.accounts}>{saved.accounts.map(account => <li key={account.id}>
            <span className={styles.model}>{account.name}</span> <span className={styles.price}>{account.modelCount} {account.modelCount === 1 ? 'model' : 'models'}</span>
          </li>)}</ul>
        </section>
        <p className={styles.readonly}>This screen is read only for now. Choosing models and effort arrives in the next slice.</p>
      </div>}
  </>;
}
