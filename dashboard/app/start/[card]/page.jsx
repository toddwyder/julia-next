import { connection } from 'next/server';
import { getReadyCard } from '../../../lib/linear.js';
import { displayName, priceLabel, readModels } from '../../../lib/models.js';
import { accountModels } from '../../../lib/account-models.js';
import { ROLE_GROUPS, leadModels, readSettings, saveSettings } from '../../../lib/model-settings.js';
import StartScreen from './start-screen.jsx';
import styles from './start.module.css';

async function saveModels(next) {
  'use server';
  try {
    return { ok: true, ...saveSettings(next, { models: await accountModels() }) };
  } catch (error) {
    console.error('julia-dashboard: model settings save failed:', error);
    return { ok: false, problem: 'The models could not be saved. Check that every role has an available model and that both settings files are writable. Your unsaved picks are still on screen.' };
  }
}

export default async function StartPage({ params }) {
  await connection();
  const { card: identifier } = await params;
  let card;
  let cardProblem;
  if (identifier) {
    try { card = await getReadyCard(identifier); }
    catch (error) { cardProblem = error.message; }
  }
  let models;
  let choice;
  let problem;
  let prices;
  try {
    models = await accountModels();
    choice = readSettings({ modelIds: models.map(model => model.id) });
    prices = readModels();
  } catch (error) {
    console.error('julia-dashboard: model settings failed to load:', error);
    problem = 'The model settings could not be read. Check the account sign-ins and settings files, then reload.';
  }
  const account = { anthropic: 'Claude subscription', openai: 'ChatGPT subscription', commandcode: 'CommandCode' };
  const picks = (models ?? []).map(model => {
    const priced = prices?.models.find(row => row.id === model.id || row.id === `mastracode/${model.id}`)
      ?? (Number.isFinite(model.inputPerMillion) ? model : null);
    return {
      id: model.id,
      provider: model.provider,
      name: displayName(model),
      price: priced ? priceLabel(priced) : 'Price unavailable',
      account: account[model.provider],
    };
  });
  return <><a className="back" href="/">← Back to Ready cards</a>
    <header><p className="eyebrow">Start screen</p>
      {identifier ? <p className="identifier">{identifier}</p> : null}
      <h1>{card?.title ?? 'Model settings'}</h1></header>
    {cardProblem ? <p className="problem" role="alert">{cardProblem}</p> : null}
    {identifier && !card && !cardProblem ? <p className="empty">This card is not Ready. You can still change the models.</p> : null}
    {problem ? <p className="problem" role="alert">{problem}</p>
      : <div className={styles.screen}>
        <StartScreen card={identifier ?? ''} groups={ROLE_GROUPS} models={picks} leadModels={leadModels(picks)}
          initial={choice} saveDraft={saveModels} />
      </div>}
  </>;
}
