import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

import { answerWithin, MAX_OUTPUT } from '../ops/julia-runner/run-tests.mjs';
import { LIMITS, limitSeconds, runLimited, STOPPED_EXIT, stoppedLine } from '../ops/julia-runner/time-limit.mjs';

// The current delivery launcher uses runLimited directly. Windows termination
// must stop the selected process tree while leaving unrelated processes alone.
const windowsOnly = { skip: process.platform !== 'win32', timeout: 15000 };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
  return check();
};
const stop = pid => { if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); };

async function timedWorker(t, { ignoreTerm = false } = {}) {
  let out = ''; let pid;
  t.after(() => stop(pid));
  const program = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', 'console.log(process.pid); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
    console.log(process.pid);
    setInterval(() => {}, 1000);
  `;
  const completion = runLimited(process.execPath, ['-e', program], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }, {
    seconds: 1.5, graceMs: 100,
    started: child => { pid = child.pid; child.stdout.on('data', chunk => { out += chunk; }); },
  });
  let deadline;
  const result = await Promise.race([completion, new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Windows worker survived its time limit')), 7000);
  })]).finally(() => clearTimeout(deadline));
  assert.equal(result.stopped, true);
  const pids = out.trim().split(/\s+/).map(Number);
  assert.equal(pids.length, 2, 'both worker and child started');
  for (const workerPid of pids) assert.ok(await until(() => !alive(workerPid)), `process ${workerPid} is gone`);
}

test('Windows time limit stops the worker and its child process', windowsOnly, async t => {
  await timedWorker(t);
});

test('Windows time limit forcibly stops a worker with a SIGTERM handler and its child', windowsOnly, async t => {
  await timedWorker(t, { ignoreTerm: true });
});

test('a worker that finishes in time retains its exit code and is not stopped', async () => {
  const result = await runLimited(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore', windowsHide: true }, {
    seconds: 5, kill: () => assert.fail('a completed worker must not be stopped'),
  });
  assert.deepEqual([result.code, result.stopped, result.signal], [3, false, null]);
});

test('Windows timeout leaves an unrelated process running', windowsOnly, async t => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => stop(unrelated.pid));
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  await timedWorker(t);
  assert.equal(alive(unrelated.pid), true, 'only the timed worker tree is stopped');
});

test('the requested time limit, within a cap, or the fallback', () => {
  assert.equal(limitSeconds(90, LIMITS.builder), 90);
  assert.equal(limitSeconds(10 * 60 * 60, LIMITS.builder), 3 * 60 * 60);
  for (const odd of [undefined, 0, -5, 1.5, '60', null]) assert.equal(limitSeconds(odd, LIMITS.builder), 60 * 60, String(odd));
  assert.equal(limitSeconds(undefined, LIMITS.tests), 15 * 60);
  assert.equal(stoppedLine(90), 'stopped: ran longer than its 90-second time limit');
  assert.equal(STOPPED_EXIT, 124, 'a timeout retains its stopped exit status');
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
