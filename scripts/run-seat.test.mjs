// run-seat.test.mjs -- JUL-98 step 8: the worker side of the single-command
// route. A fake child process stands where the agent would, so nothing here
// starts an agent or spends anything. The real route is proven on the server
// by scripts/controller-stand-in.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, agentSpawnSpec, runSeat, seatFiles, PI_ROUTE } from './run-seat.mjs';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
function tempWorktree() {
  const dir = mkdtempSync(join(tmpdir(), 'run-seat-'));
  dirs.push(dir);
  return dir;
}

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const args = (overrides = {}) => {
  const base = {
    seat: 'builder', agent: 'agy', model: 'gemini-3.8-flash', effort: 'low', tag: 'round-1-builder',
    'timeout-seconds': '60', worktree: '/w', 'brief-b64': b64('# brief\nwith "quotes" and \'apostrophes\''),
    ...overrides,
  };
  return Object.entries(base).flatMap(([k, v]) => [`--${k}`, v]);
};

test('the brief arrives intact through base64, quotes and all', () => {
  const opts = parseArgs(args());
  assert.equal(opts.brief, '# brief\nwith "quotes" and \'apostrophes\'');
  assert.equal(opts.timeoutSeconds, 60);
});

test('bad arguments are refused by name: unknown seat, agent or effort, a tag for the wrong seat, a non-whole limit, an empty brief', () => {
  assert.throws(() => parseArgs(args({ seat: 'consultant' })), /--seat must be one of/);
  assert.throws(() => parseArgs(args({ agent: 'claude' })), /--agent must be one of/);
  assert.throws(() => parseArgs(args({ effort: 'max' })), /--effort must be one of/);
  assert.throws(() => parseArgs(args({ tag: 'round-1-reviewer' })), /--tag must look like round-1-builder/);
  assert.throws(() => parseArgs(args({ tag: 'round-x-builder' })), /--tag/);
  assert.throws(() => parseArgs(args({ 'timeout-seconds': '1.5' })), /whole number/);
  assert.throws(() => parseArgs(args({ 'brief-b64': b64('   ') })), /decoded to nothing/);
  assert.throws(() => parseArgs(['--seat']), /needs a value/);
});

test('each agent runs as the one command the 23 Sep probes ran it as, with the brief as the last argument', () => {
  const agy = agentSpawnSpec({ agent: 'agy', model: 'gemini-3.8-flash', effort: 'low', brief: 'B' });
  assert.equal(agy.command, 'agy');
  assert.deepEqual(agy.args, ['-p', 'B', '--model', 'gemini-3.8-flash', '--effort', 'low', '--dangerously-skip-permissions', '--output-format', 'json']);

  const pi = agentSpawnSpec({ agent: 'pi', model: 'deepseek-v4-pro', effort: 'medium', brief: 'B' }, { readSecretImpl: () => 'SECRET' });
  assert.equal(pi.command, 'pi');
  assert.deepEqual(pi.args.slice(-4), ['--mode', 'json', '--', 'B']);
  assert.ok(pi.args.includes('commandcode'), 'the Pro reviewer runs through Command Code');
  assert.equal(pi.env.COMMANDCODE_API_KEY, 'SECRET');
  assert.throws(() => agentSpawnSpec({ agent: 'pi', model: 'gpt-6', effort: 'low', brief: 'B' }), /no Pi route/);
  assert.deepEqual(Object.keys(PI_ROUTE), ['deepseek-v4-pro', 'deepseek-v4-flash']);

  const standIn = agentSpawnSpec({ agent: 'stand-in', seat: 'builder', tag: 'round-1-builder', worktree: '/w', brief: 'B' });
  assert.equal(standIn.command, process.execPath);
  assert.deepEqual(standIn.args, [join('/w', 'scripts', 'stand-in-seat.mjs'), '--seat', 'builder', '--tag', 'round-1-builder', '--worktree', '/w']);
});

// A child process that exits when told to, or when killed.
function fakeSpawn({ exitAfterMs = null, exitCode = 0, onSpawn = () => {} } = {}) {
  const calls = [];
  const impl = (command, argv, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exit = (code, signal = null) => {
      if (child.done) return;
      child.done = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code, signal));
    };
    calls.push({ command, argv, options, child });
    onSpawn(child, options);
    if (exitAfterMs !== null) setTimeout(() => child.exit(exitCode), exitAfterMs);
    return child;
  };
  impl.calls = calls;
  return impl;
}

const optsFor = (worktree, extra = {}) => ({
  seat: 'builder', agent: 'stand-in', model: 'stand-in', effort: 'low', tag: 'round-1-builder',
  timeoutSeconds: 60, worktree, brief: 'the brief', ...extra,
});

test('a seat that finishes: its own group, the brief on disk, stale files from an earlier run cleared, and a run record written', async () => {
  const worktree = tempWorktree();
  const files = seatFiles(worktree, 'round-1-builder');
  mkdirSync(files.dir, { recursive: true });
  writeFileSync(files.answer, '{"outcome":"done","summary":"STALE"}');
  writeFileSync(files.progress, '{"type":"status","subject":"STALE"}\n');
  const spawnImpl = fakeSpawn({
    onSpawn: (child) => setTimeout(() => {
      assert.ok(!existsSync(files.answer), 'the stale answer is gone before the seat starts');
      writeFileSync(files.answer, '{"outcome":"done","summary":"fresh"}');
      child.stdout.write('agent output\n');
      child.exit(0);
    }, 10),
  });
  const record = await runSeat(optsFor(worktree), { spawnImpl });
  const [call] = spawnImpl.calls;
  assert.equal(call.options.detached, true, 'its own process group, so a stop reaches everything it started');
  assert.equal(call.options.cwd, worktree);
  assert.equal(readFileSync(files.brief, 'utf8'), 'the brief');
  assert.equal(readFileSync(files.out, 'utf8'), 'agent output\n');
  assert.equal(record.exitCode, 0);
  assert.equal(record.timedOut, false);
  assert.equal(record.answerWritten, true);
  const progress = readFileSync(files.progress, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(progress.length, 1, 'the stale progress was cleared; the one line is this run\'s own start');
  assert.equal(progress[0].type, 'status');
  assert.equal(progress[0].payload.phase, 'starting');
  assert.match(progress[0].subject, /builder started \(stand-in, stand-in, effort low\)/);
  assert.deepEqual(JSON.parse(readFileSync(files.run, 'utf8')), record);
});

test('a seat that runs past its limit is told to stop, then killed, as a GROUP -- and the record says it timed out', async () => {
  const worktree = tempWorktree();
  const kills = [];
  let child;
  const spawnImpl = fakeSpawn({ onSpawn: (c) => { child = c; } });
  const record = await runSeat(optsFor(worktree, { timeoutSeconds: 0.05 }), {
    spawnImpl,
    killGraceMs: 30,
    killImpl: (pid, signal) => {
      kills.push([pid, signal]);
      if (signal === 'SIGKILL') child.exit(null, 'SIGKILL');
    },
  });
  assert.deepEqual(kills, [[-4242, 'SIGTERM'], [-4242, 'SIGKILL']]);
  assert.equal(record.timedOut, true);
  assert.equal(record.answerWritten, false);
});

test('the agent\'s process group is written down the moment it starts, so the controller can stop it as the worker', async () => {
  const worktree = tempWorktree();
  const files = seatFiles(worktree, 'round-1-builder');
  let seenPid = null;
  const spawnImpl = fakeSpawn({ onSpawn: (child) => setTimeout(() => { seenPid = JSON.parse(readFileSync(files.pid, 'utf8')); child.exit(0); }, 5) });
  await runSeat(optsFor(worktree), { spawnImpl });
  assert.deepEqual({ pid: seenPid.pid, pgid: seenPid.pgid }, { pid: 4242, pgid: 4242 });
});

test('a Gemini seat has its allowance read before and after, and a failed reading is recorded rather than thrown', async () => {
  const worktree = tempWorktree();
  const usage = (remaining) => ({ command: { data: { groups: [{ buckets: [{ id: 'gemini-weekly', remaining_fraction: remaining, reset_time: 'R1' }, { id: 'gemini-5h', remaining_fraction: remaining, reset_time: 'R2' }] }] } } });
  const readings = [usage(0.9), usage(0.89)];
  const record = await runSeat(optsFor(worktree, { agent: 'agy', model: 'gemini-3.8-flash' }), {
    spawnImpl: fakeSpawn({ exitAfterMs: 5 }),
    readAllowanceImpl: async () => readings.shift(),
  });
  assert.equal(record.allowanceBefore['gemini-weekly'].remaining, 0.9);
  assert.equal(record.allowanceAfter['gemini-weekly'].remaining, 0.89);
  assert.equal(record.allowanceError, null);

  const failed = await runSeat(optsFor(tempWorktree(), { agent: 'agy', model: 'gemini-3.8-flash' }), {
    spawnImpl: fakeSpawn({ exitAfterMs: 5 }),
    readAllowanceImpl: async () => { throw new Error('agy not signed in'); },
  });
  assert.equal(failed.allowanceBefore, null);
  assert.match(failed.allowanceError, /agy not signed in/);
});

test('an agent that cannot be started at all is recorded as such, not left hanging', async () => {
  const worktree = tempWorktree();
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 1;
    setImmediate(() => child.emit('error', new Error('spawn agy ENOENT')));
    return child;
  };
  const record = await runSeat(optsFor(worktree), { spawnImpl });
  assert.match(record.spawnError, /ENOENT/);
});
