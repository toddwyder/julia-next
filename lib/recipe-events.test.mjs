import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRecipeEvent, recordRecipeEvent } from './recipe-events.js';

test('only known actions, outcomes, Firebase codes and counts are accepted', () => {
  assert.deepEqual(parseRecipeEvent({ action: 'save', outcome: 'failed', code: 'unavailable' }), { action: 'save', outcome: 'failed', code: 'unavailable' });
  assert.deepEqual(parseRecipeEvent({ action: 'move', outcome: 'ok', count: 3, title: 'Coq au Vin', email: 'a@b.c' }), { action: 'move', outcome: 'ok', count: 3 });
  for (const body of [null, 'save', {}, { action: 'delete', outcome: 'ok' }, { action: 'save', outcome: 'maybe' },
    { action: 'save', outcome: 'failed', code: 'Coq au Vin with a long free text body' }, { action: 'move', outcome: 'ok', count: -1 }, { action: 'move', outcome: 'ok', count: 1.5 }]) {
    assert.equal(parseRecipeEvent(body), null, JSON.stringify(body));
  }
});

test('a failed save goes to Axiom and Sentry; a good one goes only to Axiom', async () => {
  const axiom = [];
  const sentry = [];
  const options = {
    env: { AXIOM_TOKEN: 't', AXIOM_DATASET: 'd', NEXT_PUBLIC_SENTRY_DSN: 'fixture' },
    fetchImpl: async (url, init) => {
      axiom.push(JSON.parse(init.body)[0]);
      return { ok: true, json: async () => ({ ingested: 1, failed: 0 }) };
    },
    sentryImpl: { init() {}, captureException: (error, context) => { sentry.push({ error, context }); return 'event-1'; }, flush: async () => true },
  };

  const ok = await recordRecipeEvent({ action: 'save', outcome: 'ok' }, options);
  assert.deepEqual(ok, { axiom: { status: 'sent' } });
  assert.equal(sentry.length, 0);

  const failed = await recordRecipeEvent({ action: 'save', outcome: 'failed', code: 'unavailable' }, options);
  assert.deepEqual(failed, { axiom: { status: 'sent' }, sentry: { status: 'sent', eventId: 'event-1' } });
  assert.deepEqual(axiom.map(({ event, action, outcome, code }) => ({ event, action, outcome, code })), [
    { event: 'julia-next.recipes', action: 'save', outcome: 'ok', code: undefined },
    { event: 'julia-next.recipes', action: 'save', outcome: 'failed', code: 'unavailable' },
  ]);
  assert.equal(sentry[0].error.message, 'julia-next: recipe save failed (unavailable)');
  assert.deepEqual(sentry[0].context.tags, { route: '/api/recipe-events', routeType: 'route' });
});
