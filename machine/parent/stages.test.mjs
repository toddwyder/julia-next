import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStages, findPullRequest, kickoffPrompt, stageCommand } from './stages.mjs';

// A stand-in for a child process: it says how it was started, then exits.
const runDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'machine-stage-'));
const usage = { modelCalls: 2, inputTokens: 100, outputTokens: 5, cacheReadTokens: 0, costUsd: 0, models: ['reflection/beam:free'], empty: false };

function fakeSpawn(code) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    setImmediate(() => child.emit('close', code));
    return child;
  };
  return { spawn, calls };
}

test('every stage runs the program that already owns it', () => {
  const build = stageCommand('build', { card: 'JUL-330' }, {});
  assert.equal(build[0], 'mastracode');
  assert.equal(build[1][0], '-p');
  assert.match(build[1][1], /Build Linear card JUL-330/);
  assert.match(build[1][1], /move it to Implementation/);
  assert.match(build[1][1], /Open the pull request in the same step as your first push/);

  assert.deepEqual(stageCommand('remediation', { card: 'JUL-330', pr: 431 }, {}), [
    'node',
    ['scripts/julia-agents.mjs', '--', 'node', 'machine/remediation/run.mjs', '--pr', '431', '--card', 'JUL-330'],
  ]);
  assert.deepEqual(stageCommand('landing', { card: 'JUL-330', pr: 431 }, {})[1].slice(-4), ['--pr', '431', '--card', 'JUL-330']);
  assert.deepEqual(stageCommand('remediation', { card: 'JUL-330', pr: 431, model: 'a/model' }, {})[1].slice(-2), ['--model', 'a/model']);
  assert.throws(() => stageCommand('shipping', { card: 'JUL-330' }, {}), /not a stage/);
});

test('the kickoff prompt names the card and keeps Todd off the loop', () => {
  const prompt = kickoffPrompt('JUL-330');
  assert.match(prompt, /JUL-330/);
  assert.match(prompt, /Only a product decision or one approval/);
});

test('a build that lands a pull request hands that pull request to the next stage', async () => {
  const { spawn, calls } = fakeSpawn(0);
  const stage = runDir();
  const runStage = createStages({
    root: '/repo',
    env: { MASTRA_OBSERVABILITY_DB_PATH: '/run/parent.duckdb', KEEP: 'yes' },
    spawnImpl: spawn,
    find: () => ({ pr: 431 }),
    readUsage: files => ({ ...usage, files }),
    log: () => {},
  });
  const outcome = await runStage('build', { card: 'JUL-330', runDir: stage });
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.pr, 431);
  assert.equal(outcome.detail, 'the builder opened pull request #431');
  assert.deepEqual(outcome.usage.files, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, '/repo');
  // The stage writes its trace files into its own folder; the parent's file is
  // never inherited, because the parent holds it open.
  assert.equal(calls[0].options.env.JULIA_TRACES_DIR, path.join(stage, 'traces', 'build'));
  assert.equal(calls[0].options.env.MASTRA_OBSERVABILITY_DB_PATH, undefined);
  assert.equal(calls[0].options.env.KEEP, 'yes');
  assert.ok(fs.existsSync(path.join(stage, 'traces', 'build')));
});

test('a build that ends without a pull request fails, and says so', async () => {
  const { spawn } = fakeSpawn(0);
  const stage = runDir();
  const runStage = createStages({ root: '/repo', env: {}, spawnImpl: spawn, find: () => ({ error: 'the builder left no open pull request for JUL-330' }), readUsage: files => ({ ...usage, files }), log: () => {} });
  const outcome = await runStage('build', { card: 'JUL-330', runDir: stage });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.pr, null);
  assert.equal(outcome.detail, 'the builder left no open pull request for JUL-330');
  assert.ok(outcome.usage, 'a stage that ran reports what it spent even when it fails');
});

test('a stage that exits non-zero fails with the code, and a later stage is not run for it', async () => {
  const { spawn } = fakeSpawn(3);
  const stage = runDir();
  const runStage = createStages({ root: '/repo', env: {}, spawnImpl: spawn, find: () => ({ pr: 431 }), readUsage: files => ({ ...usage, files }), log: () => {} });
  const outcome = await runStage('remediation', { card: 'JUL-330', pr: 431, runDir: stage });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.pr, 431);
  assert.equal(outcome.detail, 'remediation ended with exit code 3');
  assert.ok(outcome.usage);
  const landing = await runStage('landing', { card: 'JUL-330' });
  assert.equal(landing.status, 'failed');
  assert.equal(landing.detail, 'landing needs a pull request, and the run has none');
  assert.deepEqual(await runStage('landing', { card: 'JUL-330', runDir: stage }), {
    status: 'failed',
    pr: null,
    detail: 'landing needs a pull request, and the run has none',
  });
});

test('a given pull request skips the build', async () => {
  const { spawn, calls } = fakeSpawn(0);
  const runStage = createStages({ root: '/repo', env: {}, spawnImpl: spawn, find: () => ({ pr: 1 }), log: () => {} });
  const outcome = await runStage('build', { card: 'JUL-330', pr: 431, runDir: runDir() });
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.pr, 431);
  assert.equal(outcome.usage, undefined, 'a stage that never ran spends nothing');
  assert.equal(calls.length, 0);
});

test('the pull request is the only open one that names the card', () => {
  const list = pulls => () => ({ status: 0, stdout: JSON.stringify(pulls) });
  const one = findPullRequest('JUL-330', { run: list([{ number: 431, title: 'Show runs', headRefName: 'feat/jul-330-runs' }, { number: 430, title: 'Elsewhere', headRefName: 'feat/other' }]) });
  assert.deepEqual(one, { pr: 431 });
  assert.match(findPullRequest('JUL-330', { run: list([{ number: 431, title: 'Show runs', headRefName: 'feat/jul-330' }, { number: 432, title: 'JUL-330 again', headRefName: 'feat/jul-330-b' }]) }).error, /more than one open pull request names JUL-330: #431, #432/);
  assert.match(findPullRequest('JUL-330', { run: list([]) }).error, /left no open pull request/);
  assert.match(findPullRequest('JUL-330', { run: () => ({ status: 1, stdout: '' }) }).error, /gh could not list pull requests/);
});
