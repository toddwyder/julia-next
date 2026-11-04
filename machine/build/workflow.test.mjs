// The card's workflow, driven with a fake build, a fake forge and fake stage
// commands. No model, no network, no pull request. What these rounds pin is the
// order and the stops: the build comes first, a build that runs out of time ends
// the run, a build that leaves no pull request ends it, and review and landing
// are the repo's existing commands started with the card and the pull request.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadMastra, missingProgram } from '../shipping/harness.mjs';
import { createCardWorkflow, findPullRequest, stageCommand, stageEnvironment } from './workflow.mjs';

const programGap = missingProgram();
const withoutProgram = programGap ? { skip: `${programGap}, so the card workflow runs on the server instead` } : {};

const CARD = 'JUL-999';

function fakeDeps({ built = {}, found = { pr: 42 }, stage = () => ({ status: 'done' }) } = {}) {
  const order = [];
  const stages = [];
  return {
    order,
    stages,
    deps: {
      runBuild: async ({ card }) => {
        order.push(`build ${card}`);
        return { threadId: 'thread-1', answer: 'built', timedOut: false, elapsedMs: 1000, ...built };
      },
      findPullRequest: card => {
        order.push(`find ${card}`);
        return found;
      },
      runStage: (stage_, { card, pr }) => {
        order.push(`${stage_} ${card} #${pr}`);
        stages.push({ stage: stage_, card, pr });
        return stage({ stage: stage_, card, pr });
      },
    },
  };
}

async function runCard(deps, { card = CARD, pr = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-workflow-'));
  const { Mastra, LibSQLStore } = await loadMastra();
  const mastra = new Mastra({
    storage: new LibSQLStore({ id: `card-test-${path.basename(dir)}`, url: `file:${path.join(dir, 'state.db')}` }),
    logger: false,
  });
  const { workflow } = await createCardWorkflow({ mastra, root: dir, deps, log: () => {} });
  const run = await workflow.createRun();
  const started = await run.start({ inputData: { card, pr } });
  return { started, dir, runId: run.runId };
}

// A failed workflow hands back its error wrapped, so read the sentence out of it.
function failure(started) {
  const error = started.error;
  return String(error?.message ?? error?.error?.message ?? error);
}

test('the build runs first, then the pull request is found, then review and landing', withoutProgram, async () => {
  const { deps, order } = fakeDeps();

  const { started } = await runCard(deps);

  assert.equal(started.status, 'success', started.error);
  assert.deepEqual(order, [`build ${CARD}`, `find ${CARD}`, `review ${CARD} #42`, `landing ${CARD} #42`]);
  assert.deepEqual(started.result, { card: CARD, pr: 42 });
});

test('a build that runs out of time stops the card before any review', withoutProgram, async () => {
  const { deps, order } = fakeDeps({ built: { timedOut: true, elapsedMs: 3_600_000 } });

  const { started } = await runCard(deps);

  assert.equal(started.status, 'failed');
  assert.match(failure(started), /build stopped the card: the build ran out of time/);
  assert.deepEqual(order, [`build ${CARD}`]);
});

test('a build that leaves no pull request stops the card before any review', withoutProgram, async () => {
  const { deps, order } = fakeDeps({ found: { error: `the build left no open pull request for ${CARD}` } });

  const { started } = await runCard(deps);

  assert.equal(started.status, 'failed');
  assert.match(failure(started), /no open pull request/);
  assert.deepEqual(order, [`build ${CARD}`, `find ${CARD}`]);
});

test('a failing review stops the card before landing', withoutProgram, async () => {
  const { deps, order } = fakeDeps({ stage: ({ stage: name }) => (name === 'review' ? { status: 'failed', detail: 'exit code 1' } : { status: 'done' }) });

  const { started } = await runCard(deps);

  assert.equal(started.status, 'failed');
  assert.match(failure(started), /review stopped the card: exit code 1/);
  assert.deepEqual(order, [`build ${CARD}`, `find ${CARD}`, `review ${CARD} #42`]);
});

test('a pull request handed in skips the search', withoutProgram, async () => {
  const { deps, order } = fakeDeps();

  const { started } = await runCard(deps, { pr: 7 });

  assert.equal(started.status, 'success', started.error);
  assert.deepEqual(order, [`build ${CARD}`, `review ${CARD} #7`, `landing ${CARD} #7`]);
});

test('review and landing start the repo commands with the card and the pull request', () => {
  assert.deepEqual(stageCommand('review', { card: CARD, pr: 42 }, {}), [
    'node',
    ['scripts/julia-agents.mjs', '--', 'node', 'machine/remediation/run.mjs', '--pr', '42', '--card', CARD],
  ]);
  assert.deepEqual(stageCommand('landing', { card: CARD, pr: 42 }, {}), [
    'node',
    ['scripts/julia-agents.mjs', '--', 'node', 'machine/merge/run.mjs', '--pr', '42', '--card', CARD],
  ]);
});

test('a stage can be pointed at another program that takes the same arguments', () => {
  const env = { MACHINE_REVIEW: 'fake-review', MACHINE_LANDING: 'fake-landing' };

  assert.deepEqual(stageCommand('review', { card: CARD, pr: 42 }, env), ['fake-review', ['--pr', '42', '--card', CARD]]);
  assert.deepEqual(stageCommand('landing', { card: CARD, pr: 42 }, env), ['fake-landing', ['--pr', '42', '--card', CARD]]);
});

test('a stage process is not handed the run trace file its parent holds open', () => {
  const child = stageEnvironment({ MASTRA_OBSERVABILITY_DB_PATH: '/traces/run.duckdb', MASTRA_DB_PATH: '/state.db', KEEP: 'yes' });

  assert.deepEqual(child, { KEEP: 'yes' });
});

test('one open pull request naming the card is the card’s pull request', () => {
  const run = (command, args) => ({
    status: 0,
    stdout: JSON.stringify([
      { number: 41, title: 'Something else', headRefName: 'fix/jul-410-thing' },
      { number: 42, title: 'The dashboard shows a count (JUL-999)', headRefName: 'feat/dashboard-count' },
    ]),
  });

  assert.deepEqual(findPullRequest(CARD, { root: '/repo', run, env: {} }), { pr: 42 });
});

test('two open pull requests naming the card stop the card instead of picking one', () => {
  const run = () => ({
    status: 0,
    stdout: JSON.stringify([
      { number: 42, title: 'One (JUL-999)', headRefName: 'feat/one' },
      { number: 43, title: 'Two (JUL-999)', headRefName: 'feat/two' },
    ]),
  });

  const found = findPullRequest(CARD, { root: '/repo', run, env: {} });

  assert.match(found.error, /more than one open pull request names JUL-999: #42, #43/);
});
