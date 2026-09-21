// controller-inflight.test.mjs -- JUL-98 step 2, item 5: width 1, using Orca
// rather than new code.
//
// The card is explicit that the in-flight record lives in the card's Orca run,
// which Orca already locks to one controller, and that a hand-built lock is the
// wrong answer (JUL-109 proved both: a second taker gets `consumer_fenced`, and
// a repeated request comes back `replayed: true` having started nothing). So
// this file does not test a lock. It tests that the controller uses Orca's, and
// that the ONE thing Orca does not cover -- a duplicate Linear comment -- is
// guarded by hand.
//
// Every stand-in here is built from the real recorded responses in
// graph/fixtures/orca-1.4.205/, never from an invented shape, and refuses what
// the real Orca refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  cardRunObjective,
  isConsumerFenced,
  wasReplayed,
  runIdOf,
  claimCardRun,
  createCommentGuard,
} from '../graph/controller/inflight.mjs';
import { createFixtureOrca, loadOrcaFixture, ORCA_FIXTURE_DIR } from '../graph/controller/fixture-orca.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the fixtures the stand-ins are built from are the real recorded ones, read off disk', () => {
  assert.equal(resolve(ORCA_FIXTURE_DIR), resolve(HERE, '..', 'graph', 'fixtures', 'orca-1.4.205'));
  // Read independently of the module under test, so the test cannot be fooled
  // by a stand-in that made the shapes up.
  const ok = JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, 'run-create.ok.json'), 'utf8'));
  const replayed = JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, 'run-create.replayed.json'), 'utf8'));
  const fenced = JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, 'check.consumer-fenced.error.json'), 'utf8'));
  const takeover = JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, 'run-use.takeover.json'), 'utf8'));

  assert.equal(ok.result.mutation.replayed, false);
  assert.equal(replayed.result.mutation.replayed, true);
  assert.equal(replayed.result.run.id, ok.result.run.id, 'a replay returns the SAME run -- nothing new started');
  assert.equal(fenced.ok, false);
  assert.equal(fenced.error.code, 'consumer_fenced');
  assert.equal(takeover.result.run.consumer_generation, 2);
  assert.deepEqual(loadOrcaFixture('run-create.ok.json'), ok);
});

test('the run that IS the in-flight record is named after the card', () => {
  assert.equal(cardRunObjective('JUL-92'), 'JUL-92');
  // A ticket id is checked before it is used to name anything (item 7).
  assert.throws(() => cardRunObjective('JUL-92; rm -rf /'), /ticket id/);
  assert.throws(() => cardRunObjective(''), /ticket id/);
});

test('claiming a card run: the first claim creates it, and a repeat of the SAME request starts nothing', async () => {
  const orca = createFixtureOrca();
  const requestId = 'req-controller-1';

  const first = await claimCardRun({
    runCreateImpl: orca.runCreate,
    environment: 'orchestrator-local',
    from: 'term_coordinator',
    identifier: 'JUL-92',
    requestId,
  });
  assert.equal(first.replayed, false);
  assert.ok(first.runId.startsWith('run_'));
  assert.equal(orca.runsCreated(), 1);

  // The controller crashed and came back, or its call timed out and it retried:
  // the same request id, so Orca replays the receipt.
  const again = await claimCardRun({
    runCreateImpl: orca.runCreate,
    environment: 'orchestrator-local',
    from: 'term_coordinator',
    identifier: 'JUL-92',
    requestId,
  });
  assert.equal(again.replayed, true, 'Orca reports the replay -- this is the safe-replay proof from JUL-109');
  assert.equal(again.runId, first.runId);
  assert.equal(orca.runsCreated(), 1, 'and no second run exists: width 1 held with no lock of our own');
});

test('a SECOND controller taking the run fences the first, and the first stands down rather than carrying on', async () => {
  const orca = createFixtureOrca();
  await claimCardRun({
    runCreateImpl: orca.runCreate,
    environment: 'orchestrator-local',
    from: 'term_first',
    identifier: 'JUL-92',
    requestId: 'req-1',
  });

  // The first controller is happily reading its mailbox.
  await orca.check({ terminal: 'term_first' });

  // A second controller takes the run over. This is Orca's own lock working:
  // consumer_generation goes 1 -> 2 (run-use.takeover.json).
  const takeover = await orca.runUse({ from: 'term_second' });
  assert.equal(takeover.run.consumer_generation, 2);

  // The first controller's next call is refused, exactly as recorded.
  await assert.rejects(() => orca.check({ terminal: 'term_first' }), (error) => {
    assert.equal(isConsumerFenced(error), true);
    assert.equal(error.code, 'consumer_fenced');
    assert.match(error.message, /no longer bound to Run/);
    return true;
  });

  // The second controller is fine.
  const still = await orca.check({ terminal: 'term_second' });
  assert.ok(Array.isArray(still.messages));
});

test('isConsumerFenced reads Orca\'s own code, and is not fooled by any other failure', () => {
  const fenced = new Error('orca orchestration check failed (consumer_fenced): This coordinator terminal is no longer bound to Run run_1bf570ce5660.');
  fenced.code = 'consumer_fenced';
  assert.equal(isConsumerFenced(fenced), true);

  const stale = new Error('orca terminal send failed (terminal_handle_stale): ...');
  stale.code = 'terminal_handle_stale';
  assert.equal(isConsumerFenced(stale), false, 'a stale terminal is a retry, not a stand-down');

  const notFound = new Error('orca orchestration worker-start failed (repo_not_found): ...');
  notFound.code = 'repo_not_found';
  assert.equal(isConsumerFenced(notFound), false);
  assert.equal(isConsumerFenced(new Error('network down')), false);
  assert.equal(isConsumerFenced(null), false);
});

test('wasReplayed and runIdOf read the recorded envelope shape, not a guessed one', () => {
  const ok = loadOrcaFixture('run-create.ok.json').result;
  const replayed = loadOrcaFixture('run-create.replayed.json').result;
  assert.equal(wasReplayed(ok), false);
  assert.equal(wasReplayed(replayed), true);
  assert.equal(runIdOf(ok), 'run_1bf570ce5660');
  assert.equal(runIdOf(replayed), 'run_1bf570ce5660');

  // A terminal send carries the same `mutation` shape (terminal-send.replayed.json).
  const send = loadOrcaFixture('terminal-send.replayed.json').result;
  assert.equal(wasReplayed(send), true);
  assert.equal(runIdOf(send), null, 'a send has no run, and that is reported as null rather than guessed');
});

test('the ONE thing Orca does not cover: a duplicate Linear comment, guarded by hand', async () => {
  // Orca's replay protects every Orca call. A Linear comment is not an Orca
  // call, so two attempts at the same column-move comment would put two
  // identical notes on the card. This guard is the hand-built part the card
  // says must be named.
  const posted = [];
  const guard = createCommentGuard({ postImpl: async (args) => { posted.push(args); return { id: `c${posted.length}` }; } });

  const first = await guard.postOnce({ issueId: 'uuid-92', key: 'move:Ready->Implementation', body: 'moved' });
  assert.equal(first.posted, true);
  const second = await guard.postOnce({ issueId: 'uuid-92', key: 'move:Ready->Implementation', body: 'moved' });
  assert.equal(second.posted, false, 'the same move must not be commented on twice');
  assert.equal(second.replayed, true);
  assert.equal(second.comment.id, 'c1', 'the first comment is returned, the way Orca returns a replayed receipt');
  assert.equal(posted.length, 1);

  // A different move on the same card, and the same move on a different card,
  // are both genuinely different comments.
  await guard.postOnce({ issueId: 'uuid-92', key: 'move:Implementation->Code review', body: 'moved on' });
  await guard.postOnce({ issueId: 'uuid-88', key: 'move:Ready->Implementation', body: 'moved' });
  assert.equal(posted.length, 3);
});

test('the comment guard does not record a comment that failed: the retry still posts it', async () => {
  let attempts = 0;
  const guard = createCommentGuard({
    postImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Linear API error: 500 {}');
      return { id: 'c1' };
    },
  });
  await assert.rejects(() => guard.postOnce({ issueId: 'u', key: 'k', body: 'b' }), /500/);
  const retried = await guard.postOnce({ issueId: 'u', key: 'k', body: 'b' });
  assert.equal(retried.posted, true, 'a comment that was never written must still be written');
  assert.equal(attempts, 2);
});

test('claiming a run for an unchecked ticket id is refused before any Orca call is made', async () => {
  let called = false;
  await assert.rejects(
    () => claimCardRun({
      runCreateImpl: async () => { called = true; },
      environment: 'orchestrator-local',
      from: 'term_x',
      identifier: '../../etc/passwd',
      requestId: 'r',
    }),
    /ticket id/,
  );
  assert.equal(called, false, 'nothing reaches Orca until the id is known good');
});
