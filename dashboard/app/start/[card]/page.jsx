import { connection } from 'next/server';
import { getReadyCard } from '../../../lib/linear.js';

export default async function StartPage({ params }) {
  await connection();
  const { card: identifier } = await params;
  let card;
  let failure;
  try { card = await getReadyCard(identifier); }
  catch (error) { failure = error.message; }
  return <><a className="back" href="/">← Back to Ready cards</a><header><p className="eyebrow">Start screen</p>
    <p className="identifier">{identifier}</p><h1>{card ? card.title : 'Card unavailable'}</h1></header>
    {failure ? <p className="problem" role="alert">{failure}</p> : card
      ? <section className="card"><p>This card is still Ready. Build controls will be available in a later update.</p></section>
      : <p className="empty">This card is not in Julia-next Ready. Go Back to choose a Ready card.</p>}
  </>;
}
