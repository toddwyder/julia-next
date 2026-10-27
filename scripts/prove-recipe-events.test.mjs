import assert from 'node:assert/strict';
import test from 'node:test';
import { axiomFailure, axiomQuery, sentryFailure } from './prove-recipe-events.mjs';

test('the Axiom query reads the recipe event by name and the moment it was sent', () => {
  const query = axiomQuery('julia-next', '2026-10-27T02:00:00.000Z');
  assert.match(query, /\['julia-next']/);
  assert.match(query, /datetime\("2026-10-27T02:00:00.000Z"\)/);
  assert.match(query, /event == "julia-next\.recipes"/);
  assert.match(query, /outcome == "failed"/);
});

test('a failed save is found among Axiom rows, whose fields arrive under data', () => {
  const rows = [
    { _time: '2026-10-27T02:02:48.800Z', data: { action: 'sign-in', outcome: 'ok' } },
    { _time: '2026-10-27T02:02:48.800Z', data: { action: 'save', outcome: 'failed', code: 'unavailable' } },
  ];
  assert.deepEqual(axiomFailure(rows), { status: 'found', at: '2026-10-27T02:02:48.800Z', code: 'unavailable' });
  assert.deepEqual(axiomFailure([{ _time: '2026-10-27T02:02:48.800Z', data: { action: 'save', outcome: 'ok' } }]), { status: 'missing' });
});

test('the Sentry receipt needs the failed-save message seen after the run started', () => {
  const issue = {
    title: 'Error: julia-next: recipe save failed (unavailable)',
    lastSeen: '2026-10-27T02:02:49.384000Z',
    count: '3',
    permalink: 'https://julia.sentry.io/issues/1/',
  };
  const since = '2026-10-27T02:01:41.009Z';
  assert.deepEqual(sentryFailure([issue], since), { status: 'found', title: issue.title, lastSeen: issue.lastSeen, count: '3', link: issue.permalink });
  assert.deepEqual(sentryFailure([{ ...issue, lastSeen: '2026-10-26T02:02:49.384000Z' }], since), { status: 'missing' });
  assert.deepEqual(sentryFailure([{ ...issue, title: 'Error: julia-next: boot' }], since), { status: 'missing' });
});
