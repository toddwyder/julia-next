// controller-main.test.mjs -- JUL-98 step 4: the program the systemd unit runs.
//
// THE LIMIT OF THESE TESTS, up front. Everything below runs as `runner`, which
// cannot read the controller's Linear credentials BY DESIGN, so no Linear,
// Orca or GitHub call is made here at all: every boundary is injected. What is
// proven is the ORDER and the REFUSALS -- one-shot vs loop, that a cycle that
// throws does not exit the process, that the crash-loop banner and comment
// happen, that state never goes into the read-only checkout. What is NOT
// proven is that the real services answer the way the stand-ins do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs, DEFAULT_INTERVAL_SECONDS, runLoop, runOnce, startup, stepsForCard, resolveBuild, USAGE, main,
} from '../graph/controller/main.mjs';
import {
  readControllerState, writeControllerState, emptyControllerState, assertStatePathIsWritable, defaultStatePath,
} from '../graph/controller/state.mjs';
import { recordStart, CRASH_STARTS_THRESHOLD } from '../graph/controller/crash-loop.mjs';
import { createRequestLedger } from '../graph/controller/wiring.mjs';
import { controllerFingerprint } from '../graph/controller/eligibility.mjs';
import { createFixtureOrca } from '../graph/controller/fixture-orca.mjs';

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

test('one-shot and loop are both real modes, and neither is the default', () => {
  assert.equal(parseArgs(['--once']).once, true);
  assert.equal(parseArgs(['--loop']).loop, true);
  assert.equal(parseArgs(['--loop']).intervalSeconds, DEFAULT_INTERVAL_SECONDS);
  assert.equal(parseArgs(['--loop', '--interval-seconds', '15']).intervalSeconds, 15);
  assert.equal(parseArgs(['--loop', '--interval-seconds=15']).intervalSeconds, 15);
  // No mode is not "probably the loop": a controller that starts looping
  // because an argument was dropped is exactly the accident --once exists to
  // prevent.
  assert.throws(() => parseArgs([]), /one of --once or --loop is required/);
  assert.throws(() => parseArgs(['--once', '--loop']), /exclusive/);
  assert.throws(() => parseArgs(['--loop', '--interval-seconds', '0']), /positive number/);
  assert.throws(() => parseArgs(['--forever']), /unknown argument/);
  assert.match(USAGE, /--once/);
});

// ---------------------------------------------------------------------------
// State: never in the checkout
// ---------------------------------------------------------------------------

test('the controller refuses to keep state inside its own read-only checkout', () => {
  assert.throws(
    () => assertStatePathIsWritable('/srv/orchestrator-svc/julia-next/graph/controller/state.json'),
    /read-only/,
  );
  // And the default never is.
  const path = defaultStatePath({ env: { XDG_STATE_HOME: '/home/orchestrator-svc/.local/state' } });
  assert.equal(path, '/home/orchestrator-svc/.local/state/julia-next/controller.json');
  assert.doesNotThrow(() => assertStatePathIsWritable(path));
});

test('state round-trips, and a missing or corrupt file is an EMPTY state rather than a crash on first start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'controller-state-'));
  try {
    const statePath = join(dir, 'nested', 'controller.json');
    assert.deepEqual(readControllerState({ statePath }), emptyControllerState(), 'no file yet');
    writeControllerState({ ...emptyControllerState(), ready: { i1: 'fp' }, carrying: { identifier: 'JUL-98', id: 'i1' } }, { statePath });
    assert.ok(existsSync(statePath), 'the state directory is created');
    const back = readControllerState({ statePath });
    assert.deepEqual(back.ready, { i1: 'fp' });
    assert.equal(back.carrying.identifier, 'JUL-98');

    writeFileSync(statePath, '{not json');
    assert.deepEqual(readControllerState({ statePath }), emptyControllerState(), 'a corrupt file costs one sighting, not a crash loop');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a JSON ARRAY where a map belongs falls back to the empty default, the way a non-object already does', () => {
  // `typeof [] === 'object'`, so the plainest guard lets an array straight
  // through and the controller ends up holding an array where it reads keys:
  // `state.ready[id]` is then always undefined and every card is sighted for
  // the first time, every cycle, for ever. An array is not a map; it reads back
  // as no map at all.
  const dir = mkdtempSync(join(tmpdir(), 'controller-state-array-'));
  try {
    const statePath = join(dir, 'controller.json');
    writeFileSync(statePath, JSON.stringify({ ready: [], commented: ['JUL-92'], requests: [['k', 'req_1']] }));
    const back = readControllerState({ statePath });
    assert.deepEqual(back.ready, {}, 'an array ready is no ready');
    assert.deepEqual(back.commented, {}, 'an array commented is no commented');
    assert.deepEqual(back.requests, {}, 'an array ledger is no ledger -- and a replay flag built off one would be nonsense');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the request ledger and the last error SURVIVE a restart, through the real write-and-read path', () => {
  // Why this matters, in money: a controller killed between starting a worker
  // and recording it replays that worker on the way back up. A ledger that is
  // dropped on read starts a SECOND worker instead -- two workers on one step,
  // and the width-1 rule broken by the program that enforces it.
  const dir = mkdtempSync(join(tmpdir(), 'controller-ledger-'));
  try {
    const statePath = join(dir, 'controller.json');
    const ledger = createRequestLedger({});
    ledger.record('worker-start:JUL-92:builder', { mutation: { requestId: 'req_orca_1' } });

    // Through writeControllerState, not a stand-in that bypasses the serializer.
    writeControllerState(
      { ...emptyControllerState(), requests: ledger.entries(), lastError: 'Linear said 500' },
      { statePath },
    );
    const back = readControllerState({ statePath });
    assert.deepEqual(back.requests, { 'worker-start:JUL-92:builder': 'req_orca_1' });
    assert.equal(back.lastError, 'Linear said 500', 'the crash-loop comment names the error that caused the loop');

    // And the ledger rebuilt from it really does replay rather than start again.
    assert.deepEqual(
      createRequestLedger(back.requests).flagsFor('worker-start:JUL-92:builder'),
      ['--retry-request', 'req_orca_1'],
    );

    // A field of the wrong type falls back, the way the other five do.
    writeFileSync(statePath, JSON.stringify({ requests: 'not an object', lastError: 42 }));
    const bad = readControllerState({ statePath });
    assert.deepEqual(bad.requests, {});
    assert.equal(bad.lastError, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Startup: the banner and the one card comment
// ---------------------------------------------------------------------------

const logged = () => { const lines = []; const fn = (line) => lines.push(String(line)); fn.lines = lines; return fn; };

test('EVERY start prints one journal line naming the build, looping or not', async () => {
  const log = logged();
  await startup({ state: emptyControllerState(), build: 'abc1234', pid: 7, mode: 'loop', at: '2026-09-21T14:00:00.000Z', log, warn: logged() });
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], /abc1234/);
});

test('a crash loop puts ONE comment on the card that was being carried, and says so in the journal every time', async () => {
  const comments = [];
  const commentImpl = async (comment) => { comments.push(comment); };
  const at = (n) => new Date(Date.parse('2026-09-21T14:00:00.000Z') + n * 5000).toISOString();

  let state = { ...emptyControllerState(), carrying: { identifier: 'JUL-98', id: 'issue-1' } };
  for (let i = 0; i < CRASH_STARTS_THRESHOLD - 1; i += 1) {
    state = recordStart(state, { at: at(i), build: 'abc1234', pid: i });
  }
  const warn = logged();
  // The threshold-th start.
  const first = await startup({ state, build: 'abc1234', at: at(CRASH_STARTS_THRESHOLD - 1), log: logged(), warn, commentImpl });
  assert.equal(first.detection.looping, true);
  assert.equal(first.commented, true, 'the card is told');
  assert.equal(comments.length, 1);
  assert.equal(comments[0].issueId, 'issue-1');
  assert.match(comments[0].body, /JUL-98/);
  assert.equal(warn.lines.filter((line) => line.includes('CRASH LOOP')).length, 1);

  // The next restart, still looping: the journal says it again, the card does not.
  const second = await startup({ state: first.state, build: 'abc1234', at: at(CRASH_STARTS_THRESHOLD), log: logged(), warn, commentImpl });
  assert.equal(second.detection.looping, true);
  assert.equal(second.commented, false);
  assert.equal(comments.length, 1, 'a card must not get a comment every 5 seconds for ever');
  assert.equal(warn.lines.filter((line) => line.includes('CRASH LOOP')).length, 2, 'the journal says it on every looping start');
});

test('a crash loop with no card in flight still shouts in the journal, and comments nowhere', async () => {
  const at = (n) => new Date(Date.parse('2026-09-21T14:00:00.000Z') + n * 5000).toISOString();
  let state = emptyControllerState();
  for (let i = 0; i < CRASH_STARTS_THRESHOLD - 1; i += 1) state = recordStart(state, { at: at(i), build: 'b', pid: i });
  const warn = logged();
  let commented = 0;
  const result = await startup({ state, build: 'b', at: at(CRASH_STARTS_THRESHOLD - 1), log: logged(), warn, commentImpl: async () => { commented += 1; } });
  assert.equal(result.detection.looping, true);
  assert.equal(commented, 0);
  assert.equal(warn.lines.filter((line) => line.includes('CRASH LOOP')).length, 1);
});

test('a board that refuses the crash-loop comment does not turn one failure into two', async () => {
  const at = (n) => new Date(Date.parse('2026-09-21T14:00:00.000Z') + n * 5000).toISOString();
  let state = { ...emptyControllerState(), carrying: { identifier: 'JUL-98', id: 'i1' } };
  for (let i = 0; i < CRASH_STARTS_THRESHOLD - 1; i += 1) state = recordStart(state, { at: at(i), build: 'b', pid: i });
  const warn = logged();
  const result = await startup({
    state, build: 'b', at: at(CRASH_STARTS_THRESHOLD - 1), log: logged(), warn,
    commentImpl: async () => { throw new Error('Linear said 401'); },
  });
  assert.equal(result.commented, false);
  assert.ok(warn.lines.some((line) => line.includes('Linear said 401')));
});

test('a build that cannot be resolved does not stop the controller starting', async () => {
  assert.equal(await resolveBuild({ env: { JULIA_CONTROLLER_BUILD: 'deadbee' } }), 'deadbee');
  assert.equal(await resolveBuild({ env: {}, execImpl: async () => { throw new Error('not a git repo'); } }), null);
});

// ---------------------------------------------------------------------------
// One cycle, and the loop
// ---------------------------------------------------------------------------

const boardWith = (cards) => ({
  comments: [],
  moves: [],
  async listReadyCards() { return cards; },
  async comment(entry) { this.comments.push(entry); return { id: `c${this.comments.length}` }; },
  async moveCard(entry) { this.moves.push(entry); },
});

test('a cycle that admits nothing carries nothing and hands its sightings forward', async () => {
  const board = boardWith([]);
  let carried = 0;
  const result = await runOnce({
    state: emptyControllerState(),
    board,
    boundaries: {},
    from: 'term_a',
    log: () => {},
    runControllerCheckImpl: async () => ({ status: 'empty-ready', nextReady: { i1: 'fp' }, nextCommented: {} }),
    carryCardImpl: async () => { carried += 1; },
  });
  assert.equal(result.check.status, 'empty-ready');
  assert.equal(carried, 0);
  assert.deepEqual(result.state.ready, { i1: 'fp' });
  assert.equal(result.carried, null);
});

test('an admitted card is recorded as "carrying" BEFORE the work starts, so a crash loop knows where to comment', async () => {
  const card = { id: 'i1', identifier: 'JUL-98', title: 'A card walks the board by itself' };
  const board = boardWith([card]);
  let seenWhileCarrying = null;
  await runOnce({
    state: emptyControllerState(),
    board,
    boundaries: {},
    from: 'term_a',
    log: () => {},
    now: () => '2026-09-21T14:00:00.000Z',
    // The check hands the chosen card back WITH the result -- it has already
    // moved it out of Ready, so there is nowhere left to look it up.
    runControllerCheckImpl: async () => ({ status: 'started', issue: 'JUL-98', card, runId: 'run_1', nextReady: {}, nextCommented: {} }),
    carryCardImpl: async ({ card: given }) => {
      seenWhileCarrying = given.identifier;
      return { ok: true, column: 'UAT' };
    },
  });
  assert.equal(seenWhileCarrying, 'JUL-98');
});

// A card fixture the eligibility rules really admit: in Ready, no coordinate
// label, no open blocker, and a `## UAT plan` section.
const readyCard = () => ({
  id: 'uuid-JUL-92',
  identifier: 'JUL-92',
  title: 'a card walks the board by itself',
  sortOrder: -2889,
  state: { name: 'Ready', type: 'unstarted' },
  labels: [],
  blockers: [],
  description: '## UAT plan\n\n1. I look at it.\n',
});

// The board as it really behaves: moveCard takes the card OUT of Ready. Round
// 1's stand-in kept it there, so a lookup that can only ever miss in production
// passed in the suite.
const drainingBoard = (cards) => ({
  ready: [...cards],
  comments: [],
  moves: [],
  async listReadyCards() { return [...this.ready]; },
  async comment(entry) { this.comments.push(entry); return { id: `c${this.comments.length}` }; },
  async moveCard(entry) {
    this.moves.push(entry);
    this.ready = this.ready.filter((issue) => issue.id !== entry.issueId);
  },
});

test('the admitted card reaches the carry with its REAL id, from a board that no longer has it in Ready', async () => {
  const jul92 = readyCard();
  const board = drainingBoard([jul92]);
  const orca = createFixtureOrca();
  const saved = [];
  let carriedCard = null;
  let savedBeforeCarry = null;

  // The REAL runControllerCheck, not a stand-in: the move out of Ready that
  // breaks the lookup is the one it makes itself.
  const result = await runOnce({
    state: { ...emptyControllerState(), ready: { 'uuid-JUL-92': controllerFingerprint(jul92) } },
    board,
    boundaries: { runCreateImpl: orca.runCreate, activeRunImpl: async () => null },
    from: 'term_controller',
    log: () => {},
    now: () => '2026-09-21T14:00:00.000Z',
    saveState: (next) => { saved.push(next); },
    carryCardImpl: async ({ card }) => {
      carriedCard = card;
      savedBeforeCarry = saved[saved.length - 1] ?? null;
      return { ok: true, column: 'UAT' };
    },
  });

  assert.equal(result.check.status, 'started');
  assert.deepEqual(board.ready, [], 'the card really did leave Ready, exactly as it does in production');
  assert.ok(carriedCard, 'a card was carried');
  assert.equal(carriedCard.id, 'uuid-JUL-92', 'a null id here means every Linear write for this card fails');
  assert.equal(carriedCard.identifier, 'JUL-92');
  assert.equal(carriedCard.title, jul92.title, 'the whole card, not a stub rebuilt from the identifier');

  // And the crash-loop comment has somewhere to go: the carry is on disk,
  // with the real id, BEFORE the work that might kill the process starts.
  assert.ok(savedBeforeCarry, 'the carry was written down before the work started');
  assert.equal(savedBeforeCarry.carrying.id, 'uuid-JUL-92');
  assert.equal(savedBeforeCarry.carrying.identifier, 'JUL-92');
});

test('a check that admits a card but hands back no card is an ERROR, never a null-id card carried in silence', async () => {
  await assert.rejects(
    () => runOnce({
      state: emptyControllerState(),
      board: drainingBoard([]),
      boundaries: {},
      from: 'term_controller',
      log: () => {},
      runControllerCheckImpl: async () => ({ status: 'started', issue: 'JUL-98', runId: 'run_1', nextReady: {}, nextCommented: {} }),
      carryCardImpl: async () => { throw new Error('the carry must never be reached'); },
    }),
    /JUL-98/,
  );
});

test('a cycle that THROWS does not exit the process -- exiting is what makes systemd restart, and a restart loop is the thing being avoided', async () => {
  const warn = logged();
  const saved = [];
  let calls = 0;
  const state = await runLoop({
    state: emptyControllerState(),
    cycles: 3,
    intervalSeconds: 1,
    sleepImpl: async () => {},
    warn,
    saveState: (next) => saved.push(next),
    runOnceImpl: async ({ state: current }) => {
      calls += 1;
      if (calls === 2) throw new Error('Linear said 500');
      return { state: { ...current, cycles: calls } };
    },
  });
  assert.equal(calls, 3, 'all three cycles ran');
  assert.ok(warn.lines.some((line) => line.includes('Linear said 500')));
  assert.equal(state.cycles, 3, 'the loop carried on after the failure');
  assert.equal(saved.length, 3, 'every cycle, failure included, saved its state');
  assert.equal(saved[1].lastError, 'Linear said 500', 'the error is kept, so a crash-loop comment can name it');
});

test('the one-shot runs exactly one cycle and never sleeps', async () => {
  let cycles = 0;
  let slept = 0;
  await runLoop({
    state: emptyControllerState(),
    cycles: 1,
    sleepImpl: async () => { slept += 1; },
    runOnceImpl: async ({ state }) => { cycles += 1; return { state }; },
  });
  assert.equal(cycles, 1);
  assert.equal(slept, 0, 'a one-shot that sleeps would hold the terminal for an interval for nothing');
});

test('the loop waits the configured interval between cycles, in Orca-free wall time', async () => {
  const waits = [];
  await runLoop({
    state: emptyControllerState(),
    cycles: 3,
    intervalSeconds: 30,
    sleepImpl: async (ms) => { waits.push(ms); },
    runOnceImpl: async ({ state }) => ({ state }),
  });
  assert.deepEqual(waits, [30000, 30000], 'between cycles, not after the last one');
});

test('a step plan is built from the card itself, one step, with its own criteria', () => {
  const [step] = stepsForCard({ identifier: 'JUL-98', title: 'A card walks the board', description: 'the brief', criteria: ['a', 'b'] });
  assert.equal(step.title, 'A card walks the board');
  assert.equal(step.brief, 'the brief');
  assert.deepEqual(step.criteria, ['a', 'b']);
});

test('the start is written down BEFORE any preflight can exit, or a build that dies in startup would be invisible to the crash-loop detector', async () => {
  // The crash loop that matters most is the one that happens before the first
  // cycle -- a bad module, a missing handle, a broken checkout. If the start
  // record were only saved after the preflights, every such loop would restart
  // for ever with an empty start list and never be detected.
  //
  // main() is called for real here. It reaches no service: with no
  // JULIA_CONTROLLER_TERMINAL it refuses before the first Orca or Linear call,
  // which is exactly the early exit being tested.
  const dir = mkdtempSync(join(tmpdir(), 'controller-main-'));
  try {
    const statePath = join(dir, 'controller.json');
    const warn = logged();
    let exit = 0;
    await main({
      argv: ['--once'],
      env: { JULIA_CONTROLLER_BUILD: 'deadbee' },
      statePath,
      log: () => {},
      warn,
      setExitCode: (code) => { exit = code; },
    });
    assert.equal(exit, 1, 'it refused, before any service call');
    assert.ok(warn.lines.some((line) => line.includes('JULIA_CONTROLLER_TERMINAL')));

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.starts.length, 1, 'the start was recorded despite the early exit');
    assert.equal(state.starts[0].build, 'deadbee');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
