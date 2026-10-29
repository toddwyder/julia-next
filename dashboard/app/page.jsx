import { Suspense } from 'react';
import { connection } from 'next/server';
import { listReady } from '../lib/linear.js';

async function ReadyCards() {
  await connection();
  let cards;
  try { cards = await listReady(); }
  catch (error) {
    console.error('julia-dashboard: Ready cards failed to load:', error);
    return <p className="problem" role="alert">{error.message}</p>;
  }
  if (!cards.length) return <p className="empty">No Ready cards. Cards will appear here when they are Ready in Linear.</p>;
  return <ul className="cards">{cards.map(card => <li key={card.id} className="card">
    <div className="card-copy"><p className="identifier">{card.identifier}</p><h2>{card.title}</h2></div>
    <a className="button" href={`/start/${card.identifier}`} aria-label={`Start ${card.title}`}>Start<span aria-hidden="true"> ↗</span></a>
  </li>)}</ul>;
}

export default function Page() {
  return <><header><p className="eyebrow">Julia dashboard</p><h1>Ready cards</h1><p>Choose a card to open its Start screen.</p></header>
    <Suspense fallback={<p role="status" className="loading">Loading Ready cards from Linear…</p>}><ReadyCards /></Suspense>
  </>;
}
