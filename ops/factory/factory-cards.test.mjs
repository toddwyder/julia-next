// factory-cards.test.mjs -- issue #140, blocker 1/2: read Factory's own card
// records for the Monday note.
//
// The established deployment mechanism is the read-only PostgreSQL route the
// wait watcher already uses (ops/factory/wait-alerts.py --config, a peer role
// with SELECT only; ops/factory/install-wait-alerts.sh creates it). There is a
// supported HTTP board route too, but it sits behind the host sign-in gate,
// which a timer has no session for. So the card reader runs one read-only
// `psql` query and normalises `work_items` rows; tests inject a fake runner, so
// no test reaches a database.
import test from 'node:test';
import assert from 'node:assert/strict';

import { FACTORY_CARDS_SQL, normalizeWorkItemRows, readFactoryCards } from './factory-cards.mjs';

const row = {
  number: 140,
  title: 'Monday note',
  stages: ['done'],
  stage_history: [
    { stage: 'planning', enteredAt: '2026-09-22T09:00:00Z', exitedAt: '2026-09-22T09:15:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
    { stage: 'execute', enteredAt: '2026-09-22T09:15:00Z', exitedAt: '2026-09-22T12:30:00Z', by: 'agent:r1', exitedBy: 'agent:r2' },
    { stage: 'done', enteredAt: '2026-09-22T13:12:00Z', by: 'agent:r2' },
  ],
  sessions: { 'session-140': { sessionId: 'session-140', threadId: 'th', branch: 'b', startedBy: 'todd' } },
  accepted_at: '2026-09-22T09:00:00Z',
  created_at: '2026-09-22T08:59:00Z',
  external_source: { type: 'github-issue', externalId: '140' },
};

test('the read is one read-only query against the Factory work-items table', () => {
  assert.match(FACTORY_CARDS_SQL, /BEGIN TRANSACTION READ ONLY/);
  assert.match(FACTORY_CARDS_SQL, /FROM julia_monday_work_items/);
  assert.match(FACTORY_CARDS_SQL, /stage_history|stages/);
  assert.match(FACTORY_CARDS_SQL, /'review'/);
  assert.match(FACTORY_CARDS_SQL, /github-pr:/);
});

test('normalizeWorkItemRows maps a row to the note\'s card shape with number, steps and sessions', () => {
  const [card] = normalizeWorkItemRows([row]);

  assert.equal(card.number, 140);
  assert.equal(card.title, 'Monday note');
  assert.equal(card.enteredAt, '2026-09-22T09:00:00Z');
  assert.deepEqual(Object.keys(card.sessions), ['session-140']);
  assert.equal(card.stageHistory.length, 3);
  assert.deepEqual(card.stageHistory.map((entry) => entry.stage), ['planning', 'execute', 'done']);
});

test('a row with no card reference fails instead of disappearing from the report', () => {
  const { number: _number, ...noNumber } = row;
  assert.throws(() => normalizeWorkItemRows([noNumber]), /no usable reference/);
});

test('review cards keep a distinct PR reference so issue and PR numbers cannot collide', () => {
  const [review] = normalizeWorkItemRows([{ ...row, board: 'review', number: 'PR-140' }]);
  assert.equal(review.number, 'PR-140');
});

test('readFactoryCards runs psql read-only and returns the normalised cards', async () => {
  const calls = [];
  const runPsql = async (args) => {
    calls.push(args);
    return { stdout: `${JSON.stringify(row)}\n`, stderr: '', status: 0 };
  };

  const cards = await readFactoryCards({
    config: { database: 'factory', project_id: 'proj', user_id: 'todd', factory_url: 'https://f.example' },
    runPsql,
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].number, 140);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('ON_ERROR_STOP=1'));
  assert.equal(calls[0].env.PGOPTIONS, '-c default_transaction_read_only=on');
});

test('readFactoryCards fails closed on a non-zero psql exit', async () => {
  const runPsql = async () => ({ stdout: '', stderr: 'permission denied', status: 1 });

  await assert.rejects(
    () => readFactoryCards({ config: { database: 'factory' }, runPsql }),
    /permission denied|read Factory cards/i,
  );
});
