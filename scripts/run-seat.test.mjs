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
import { spawn } from 'node:child_process';

import {
  parseArgs, agentSpawnSpec, runSeat, seatFiles, PI_ROUTE,
  activityTracker, seatCpuByPid, piSessionDirFor, CPU_ACTIVE_SECONDS, ACTIVITY_SAMPLE_MS,
} from './run-seat.mjs';

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
    'timeout-seconds': '60', worktree: '/w', 'seat-token': '0123456789abcdef0123456789abcdef', 'brief-b64': b64('# brief\nwith "quotes" and \'apostrophes\''),
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

test('the seat token reaches the agent (and so everything it starts) as JULIA_SEAT_TOKEN, and a bad token is refused', async () => {
  const worktree = tempWorktree();
  const spawnImpl = fakeSpawn({ exitAfterMs: 5 });
  await runSeat(optsFor(worktree, { seatToken: 'a'.repeat(32) }), { spawnImpl });
  assert.equal(spawnImpl.calls[0].options.env.JULIA_SEAT_TOKEN, 'a'.repeat(32));
  assert.throws(() => parseArgs(args({ 'seat-token': 'not-hex' })), /--seat-token must be 32 lowercase hex/);
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

// ---------------------------------------------------------------------------
// Busy but silent (JUL-92, 23 Sep 07:01Z): a DeepSeek reviewer 30 tool calls
// into a review was stopped as stuck because it wrote no progress line for 5
// minutes. The activity file is how the controller sees such a seat working.
// ---------------------------------------------------------------------------

test('Pi\'s session log folder is found where Pi keeps it for a working copy', () => {
  assert.equal(
    piSessionDirFor('/home/runner/orca/workspaces/julia-next/jul-92-work-a11', '/home/runner').replaceAll('\\', '/'),
    '/home/runner/.pi/agent/sessions/--home-runner-orca-workspaces-julia-next-jul-92-work-a11--',
  );
});

test('the activity look counts CPU only past its threshold, and output or Pi session log growth; nothing moving is nothing', () => {
  const worktree = tempWorktree();
  const files = seatFiles(worktree, 'round-1-reviewer');
  const sessionDir = join(worktree, 'sessions');
  mkdirSync(files.dir, { recursive: true });
  mkdirSync(sessionDir);
  let cpu = new Map([['100', 1.0]]);
  const look = activityTracker({ token: 'a'.repeat(32), files, sessionDir, cpuImpl: () => cpu });
  assert.deepEqual(look(), ['cpu +1.0s'], 'the first look counts what the seat used so far');
  assert.deepEqual(look(), [], 'nothing moved');
  cpu = new Map([['100', 1.0 + CPU_ACTIVE_SECONDS / 2]]);
  assert.deepEqual(look(), [], 'idling on a network wait is not work');
  cpu = new Map([['100', 3.25], ['101', 0.5]]);
  assert.deepEqual(look(), ['cpu +2.5s'], 'a new process counts too');
  writeFileSync(files.out, '{"type":"message_update"}\n');
  writeFileSync(join(sessionDir, 's.jsonl'), '{"type":"message"}\n');
  assert.deepEqual(look(), ['output 26 bytes', 'Pi session log 19 bytes']);
  assert.deepEqual(look(), []);
  cpu = new Map();
  assert.deepEqual(look(), [], 'finished processes are not counted as negative work');
});

test('the seat CPU is read only from processes carrying THIS seat\'s token, children included', () => {
  const token = 'b'.repeat(32);
  const proc = {
    '/proc/10/environ': `PATH=/bin\0JULIA_SEAT_TOKEN=${token}\0`,
    '/proc/10/stat': '10 (node (x)) S 1 10 10 0 -1 0 0 0 0 0 150 50 30 20 20 0',
    '/proc/11/environ': `JULIA_SEAT_TOKEN=${'c'.repeat(32)}\0`,
    '/proc/11/stat': '11 (pi) S 1 11 11 0 -1 0 0 0 0 0 9999 9999 0 0 20 0',
  };
  const cpu = seatCpuByPid(token, {
    readdirImpl: () => ['10', '11', '12', 'self'],
    readFileImpl: (path) => { if (!(path in proc)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return proc[path]; },
  });
  assert.deepEqual([...cpu], [['10', 2.5]], '(150+50+30+20) ticks at 100 a second; a comm with ") " in it is read right');
  assert.equal(seatCpuByPid(token, { readdirImpl: () => { throw new Error('no /proc'); } }).size, 0);
});

test('while the seat runs, the activity file is rewritten only when the seat did something', async () => {
  const worktree = tempWorktree();
  const files = seatFiles(worktree, 'round-1-builder');
  let cpu = 0;
  const spawnImpl = fakeSpawn({
    onSpawn: (child) => {
      setTimeout(() => { cpu = 5; }, 30);
      setTimeout(() => {
        assert.ok(existsSync(files.activity), 'busy: the activity file was written');
        const before = readFileSync(files.activity, 'utf8');
        setTimeout(() => {
          assert.equal(readFileSync(files.activity, 'utf8'), before, 'idle: it was not rewritten');
          child.exit(0);
        }, 60);
      }, 80);
    },
  });
  let n = 0;
  await runSeat(optsFor(worktree), {
    spawnImpl, activitySampleMs: 10, cpuImpl: () => new Map([['1', cpu]]), now: () => `T${(n += 1)}`,
  });
  assert.deepEqual(JSON.parse(readFileSync(files.activity, 'utf8')).moved, ['cpu +5.0s']);
  assert.equal(ACTIVITY_SAMPLE_MS, 20000);
});

test('a stale activity file from an earlier run is cleared before the seat starts', async () => {
  const worktree = tempWorktree();
  const files = seatFiles(worktree, 'round-1-builder');
  mkdirSync(files.dir, { recursive: true });
  writeFileSync(files.activity, '{"at":"STALE"}\n');
  await runSeat(optsFor(worktree), { spawnImpl: fakeSpawn({ exitAfterMs: 5 }), cpuImpl: () => new Map() });
  assert.equal(existsSync(files.activity), false);
});

test('a REAL busy process carrying the token shows up as CPU use; one carrying another token does not', { skip: process.platform === 'win32' ? 'reads /proc, Linux only' : false }, async () => {
  const token = 'd'.repeat(32);
  const busy = spawn(process.execPath, ['-e', 'const end = Date.now() + 1500; while (Date.now() < end) {}'], { env: { ...process.env, JULIA_SEAT_TOKEN: token }, stdio: 'ignore' });
  const other = spawn(process.execPath, ['-e', 'const end = Date.now() + 1500; while (Date.now() < end) {}'], { env: { ...process.env, JULIA_SEAT_TOKEN: 'e'.repeat(32) }, stdio: 'ignore' });
  try {
    const look = activityTracker({ token, files: seatFiles(tempWorktree(), 'round-1-builder') });
    await new Promise((r) => { setTimeout(r, 1000); });
    const moved = look();
    assert.equal(moved.length, 1, JSON.stringify(moved));
    assert.match(moved[0], /^cpu \+0\.[5-9]s|^cpu \+1\.\ds/);
    assert.ok(!seatCpuByPid(token).has(String(other.pid)));
  } finally {
    busy.kill('SIGKILL');
    other.kill('SIGKILL');
  }
});
