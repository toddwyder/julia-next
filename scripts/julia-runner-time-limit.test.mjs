import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

import { runLimited } from '../ops/julia-runner/time-limit.mjs';

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
