import { join } from 'node:path';
import { connection } from 'next/server';
import ROLES from '../../../config/roles.json';
import { getReadyCard } from '../../../lib/linear.js';
import { accountProviders, displayName, onePerName, priceLabel, readModels, startModels } from '../../../lib/models.js';
import { initialChoice, mergeDraft } from '../../../lib/roles.js';
import { readJsonRecord, stateFolder, writeJsonRecord } from '../../../lib/state.js';
import StartScreen from './start-screen.jsx';
import styles from './start.module.css';

const { groups: GROUPS } = ROLES;
const DRAFT_FILE = () => join(stateFolder(), 'draft.json');

const SWEEP_MISSING = 'No model sweep has run yet, so there are no models or prices to show. Go back to the list and open this card again after the weekly sweep.';
const UNPRICED_MISSING = 'The sweep has saved no model with a price, so this screen has nothing to show. Go back to the list and open this card again after the next sweep.';

function sweepDay(date) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

// Only a model the sweep recorded a price for may reach the screen, even if the file was
// edited by hand. A free model is priced at zero, so it counts as priced. One row per name:
// an alias and its dated snapshot are the same model to the person choosing.
function pricedModels(saved) {
  return onePerName((saved.models ?? []).filter(model => model.free === true
    || (Number.isFinite(model.inputPerMillion) && Number.isFinite(model.outputPerMillion))));
}

const modelLine = model => ({ name: model.displayName ?? displayName(model), price: priceLabel(model) });

// The browser sends the whole draft back, so it is treated as untrusted: every group, role
// and model is checked against the config and the latest sweep before anything is written.
async function saveDraft(next) {
  'use server';
  const saved = readModels();
  const picked = startModels(saved);
  const models = pricedModels(saved);
  const modelIds = models.map(model => model.id);
  const fallback = initialChoice({
    groups: GROUPS, modelIds, fallback: picked.mainSession?.id ?? '', effort: picked.effort,
  });
  const choice = mergeDraft({ saved: next, fallback, modelIds });
  const updatedAt = new Date().toISOString();
  writeJsonRecord(DRAFT_FILE(), {
    ...choice,
    card: String(next?.card ?? '').slice(0, 40),
    updatedAt,
  });
  return { updatedAt };
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
  const models = saved ? pricedModels(saved) : [];

  let draft;
  if (picked?.mainSession && picked?.shipping) {
    const record = readJsonRecord(DRAFT_FILE());
    if (record.error) console.error(`julia-dashboard: draft.json ${record.error}; starting from the sweep defaults.`);
    draft = record.value;
  }
  const fresh = picked?.mainSession
    ? initialChoice({
      card: identifier, groups: GROUPS, modelIds: models.map(model => model.id),
      fallback: picked.mainSession.id, effort: picked.effort,
    })
    : null;
  const choice = draft && fresh
    ? mergeDraft({ saved: draft, fallback: fresh, modelIds: models.map(model => model.id) })
    : fresh;
  // One account can answer to more than one provider name: Mastra Code lists the CommandCode
  // models as both `commandcode/…` and `mastracode/commandcode/…`.
  const savedAccounts = saved?.accounts ?? [];
  const providersOf = account => accountProviders(account);
  const accountFor = provider => savedAccounts.find(account => providersOf(account).includes(provider));
  const accountRank = provider => savedAccounts.findIndex(account => providersOf(account).includes(provider));
  const accounts = savedAccounts.map(account => ({
    id: account.id,
    name: account.name,
    modelCount: models.filter(model => providersOf(account).includes(model.provider)).length,
  }));
  const picks = models
    .map(model => ({
      id: model.id,
      provider: model.provider,
      ...modelLine(model),
      account: accountFor(model.provider)?.name ?? model.provider,
    }))
    .sort((left, right) => (accountRank(left.provider) - accountRank(right.provider)) || left.name.localeCompare(right.name));

  return <><a className="back" href="/">← Back to Ready cards</a>
    <header><p className="eyebrow">Start screen</p>
      <p className="identifier">{identifier}</p><h1>{card ? card.title : 'Card unavailable'}</h1></header>
    {failure ? <p className="problem" role="alert">{failure}</p>
      : !card ? <p className="empty">This card is not in Julia-next Ready. Go Back to choose a Ready card.</p>
      : modelsProblem ? <p className="problem" role="alert">{modelsProblem}</p>
      : saved.status === 'missing' || saved.status === 'empty' ? <p className="empty">{SWEEP_MISSING}</p>
      : !picked.mainSession || !picked.shipping || !choice ? <p className="empty">{UNPRICED_MISSING}</p>
      : <div className={styles.screen}>
        {saved.status === 'stale' ? <p className={styles.stale} role="status">
          The last sweep was on {sweepDay(saved.sweptAt)}. That is more than eight days ago. Run the weekly sweep to refresh these prices.
        </p> : null}
        <StartScreen card={identifier} groups={GROUPS} models={picks} initial={choice}
          mainSession={modelLine(picked.mainSession)} shipping={modelLine(picked.shipping)} saveDraft={saveDraft} />
        <section className={styles.section} aria-labelledby="prices-heading">
          <h2 id="prices-heading">Prices</h2>
          <p className={styles.sources}>Prices paid per million tokens. ↓ is what you are charged for what you send, ↑ for what the model writes. Read from each provider&apos;s pricing page on {sweepDay(saved.sweptAt)}.</p>
          <ul className={styles.accounts}>{accounts.map(account => <li key={account.id}>
            <span className={styles.model}>{account.name}</span> <span className={styles.price}>{account.modelCount} {account.modelCount === 1 ? 'model' : 'models'}</span>
          </li>)}</ul>
        </section>
      </div>}
  </>;
}
