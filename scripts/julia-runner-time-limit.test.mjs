import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerWithin, MAX_OUTPUT } from '../ops/julia-runner/run-tests.mjs';
import { LIMITS, limitSeconds, runLimited, STOPPED_EXIT, stoppedLine } from '../ops/julia-runner/time-limit.mjs';

// The time limit each worker's launcher enforces (JUL-126): a worker that runs
// too long is stopped with everything it started, even if the graph has died.
// These tests start real processes, so they need Linux process groups.
const linuxOnly = { skip: process.platform === 'win32' && 'process groups are Linux-only' };

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

// Never sends the real "kill every process of this account" signal: that
// would end the whole test account's session. It is recorded instead.
function safeKill() {
  const swept = [];
  const kill = (pid, signal) => (pid === -1 ? swept.push(signal) : process.kill(pid, signal));
  return { kill, swept };
}

// A worker that starts a child and runs forever; both print their pid.
const worker = (ignoreTerm = false) => `
  const { spawn } = require('node:child_process');
  spawn(process.execPath, ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
  console.log(process.pid);
  ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
  setInterval(() => {}, 1000);
`;

async function runForever({ ignoreTerm = false, seconds = 0.4, graceMs = 300, account = 'gemini-worker' } = {}) {
  const { kill, swept } = safeKill();
  let out = '';
  const result = await runLimited(process.execPath, ['-e', worker(ignoreTerm)], { stdio: ['ignore', 'pipe', 'ignore'] }, {
    seconds, graceMs, kill, account, started: (child) => child.stdout.on('data', (d) => { out += d; }),
  });
  return { result, swept, pids: out.trim().split(/\s+/).map(Number) };
}

test('a worker past its limit is stopped, and so is the child it started', linuxOnly, async () => {
  const { result, swept, pids } = await runForever();
  assert.equal(result.stopped, true);
  assert.equal(pids.length, 2, 'the worker and its child both started');
  for (const pid of pids) assert.ok(await until(() => !alive(pid)), `process ${pid} is gone`);
  assert.deepEqual(swept, ['SIGKILL'], "then the worker account's leftovers are swept");
});

test('a worker that ignores the polite stop is killed after the grace period', linuxOnly, async () => {
  const started = Date.now();
  const { result, pids } = await runForever({ ignoreTerm: true, graceMs: 400 });
  assert.equal(result.stopped, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started >= 700, 'it waited out the grace period first');
  for (const pid of pids) assert.ok(await until(() => !alive(pid)), `process ${pid} is gone`);
});

test('a worker that finishes in time is not stopped and nothing is swept', linuxOnly, async () => {
  const { kill, swept } = safeKill();
  const result = await runLimited(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' }, { seconds: 5, kill, account: 'gemini-worker' });
  assert.deepEqual([result.code, result.stopped], [3, false]);
  assert.deepEqual(swept, []);
});

test('only the two worker accounts are ever swept', linuxOnly, async () => {
  const { result, swept } = await runForever({ account: 'ubuntu' });
  assert.equal(result.stopped, true);
  assert.deepEqual(swept, []);
});

test('the limit is the one the graph asked for, within a cap, or the fallback', () => {
  assert.equal(limitSeconds(90, LIMITS.builder), 90);
  assert.equal(limitSeconds(10 * 60 * 60, LIMITS.builder), 3 * 60 * 60);
  for (const odd of [undefined, 0, -5, 1.5, '60', null]) assert.equal(limitSeconds(odd, LIMITS.builder), 60 * 60, String(odd));
  assert.equal(limitSeconds(undefined, LIMITS.tests), 15 * 60);
  assert.equal(stoppedLine(90), 'stopped: ran longer than its 90-second time limit');
  assert.equal(STOPPED_EXIT, 124, 'the graph reads 124 as stopped (graph/pydantic workers.STOPPED_EXIT)');
});

test('a test run that is stopped answers as stopped, and one that finishes answers normally', async () => {
  const request = { worktree: '/srv/julia-runner/worktrees/card-7', run: 'suite', limit_seconds: 30 };
  const calls = [];
  const fakeRun = (result) => async (command, args, options, limits) => {
    calls.push({ args, seconds: limits.seconds, cwd: options.cwd });
    limits.started({ stdout: { on: (e, f) => f('ℹ tests 1\n') }, stderr: { on: () => {} } });
    return result;
  };
  const stopped = await answerWithin(request, { run: fakeRun({ code: null, signal: 'SIGTERM', stopped: true }), problem: () => null });
  assert.deepEqual(stopped, { status: STOPPED_EXIT, stopped: true, output: stoppedLine(30) });
  const done = await answerWithin(request, { run: fakeRun({ code: 0, signal: null, stopped: false }), problem: () => null });
  assert.deepEqual(done, { status: 0, output: 'ℹ tests 1\n' });
  assert.equal(calls[0].seconds, 30);
  assert.equal(calls[0].cwd, request.worktree);
  assert.ok(calls[0].args.includes('--test'), 'it ran the suite command');
  const refused = await answerWithin({ ...request, worktree: '/etc' }, { run: fakeRun({}), problem: () => 'refused: not a card worktree' });
  assert.equal(refused.status, 2);
});

test('the test worker says when the tests print, and keeps at most the newest 16 MiB of output', async () => {
  const request = { worktree: '/srv/julia-runner/worktrees/card-7', run: 'suite' };
  let printed = 0;
  const chunk = 'x'.repeat(1024 * 1024);
  const run = async (command, args, options, limits) => {
    const listeners = [];
    limits.started({ stdout: { on: (e, f) => listeners.push(f) }, stderr: { on: () => {} } });
    for (let i = 0; i < 17; i += 1) listeners[0](chunk);
    listeners[0]('the end');
    return { code: 0, signal: null, stopped: false };
  };
  const reply = await answerWithin(request, { run, problem: () => null, onOutput: () => { printed += 1; } });
  assert.equal(printed, 18);
  assert.equal(reply.output.length, MAX_OUTPUT);
  assert.ok(reply.output.endsWith('the end'), 'the newest output is kept');
});
