// The graph's reviewer launcher (JUL-128): ops/julia-runner/run-reviewer.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLimited } from '../ops/julia-runner/time-limit.mjs';
import { BUILDERS, codexModel, codexReply, geminiMessages, geminiReply, piReply, PYTHON, REAPER, REVIEWERS, review, SCOPE_PREFIX, STOP_GRACE_MS, stopScope, userManager } from '../ops/julia-runner/run-reviewer.mjs';

// For the tests that fake the run: a user manager that is there, and a scope with nothing left in it.
const FREE = { manager: () => ({ XDG_RUNTIME_DIR: '/run/user/1' }), stop: async () => [] };

const LAUNCHER = fileURLToPath(new URL('../ops/julia-runner/run-reviewer.mjs', import.meta.url));

test('the reaper always has time to finish its sweep before anything kills it', async () => {
  const reap = readFileSync(REAPER, 'utf8');
  const seconds = (name) => Number(new RegExp(`^${name} = (\\d+)$`, 'm').exec(reap)?.[1]);
  const sweep = seconds('GRACE_SECONDS') + seconds('KILL_SECONDS');
  assert.ok(sweep > 0, 'read reap.py\'s sweep time');
  assert.ok(STOP_GRACE_MS >= (sweep + 5) * 1000, `the launcher waits ${STOP_GRACE_MS} ms; reap.py may sweep for ${sweep} s`);
  // the same grace at the time limit, where runLimited sends the group SIGKILL
  let grace;
  await review({ reviewer: 'codex', prompt: 'p' }, { run: async (c, a, o, limits) => { grace = limits.graceMs; return { stopped: true }; }, contain: FREE });
  assert.equal(grace, STOP_GRACE_MS);
});
const PI_FIXTURE = fileURLToPath(new URL('../graph/fixtures/orca-1.4.205/cost.pi.seat-json-stream.multi-turn.jsonl', import.meta.url));
const lines = (...events) => events.map((e) => JSON.stringify(e)).join('\n');

test('Codex is started read-only, on the pinned model, with the prompt on stdin', () => {
  const spec = REVIEWERS.codex('the brief');
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args, ['exec', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort=high', '-s', 'read-only', '--skip-git-repo-check', '--json', '-']);
  assert.equal(spec.stdin, true);
  assert.deepEqual(Object.keys(spec.env).sort(), ['HOME', 'LANG', 'PATH']);
});

test('the Codex builder gets the selected worktree, write sandbox and its own limit', async () => {
  const worktree = '/srv/julia-runner/worktrees/card-999';
  const spec = BUILDERS.codex('the brief', worktree);
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args, ['exec', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort=high', '-s', 'workspace-write', '-C', worktree, '--json', '-']);
  let seen;
  await review({ builder: 'codex', worktree, prompt: 'p', limit_seconds: 99999 }, {
    role: 'builder', contain: FREE, worktreeCheck: () => null,
    run: async (command, args, options, limits) => { seen = { command, args, options, limits }; return { stopped: true }; },
  });
  assert.equal(seen.command, 'systemd-run');
  assert.equal(seen.options.cwd, worktree);
  assert.equal(seen.limits.seconds, 10800);
  assert.match((await review({ builder: 'codex', worktree: '/tmp/elsewhere', prompt: 'p' }, {
    role: 'builder', run: () => assert.fail('must not start'), contain: FREE,
  })).error, /not a card worktree/);
});

test('Gemini review uses its reported model and only a completed, non-denied final result', () => {
  const init = { event: 'init', conversation_id: 'turn-1', init: { model: 'gemini-3.8-flash' } };
  const result = { event: 'result', result: { conversation_id: 'turn-1', status: 'SUCCESS', response: '{"verdict":"approve"}' } };
  assert.deepEqual(geminiReply(lines(init, result)), { ok: true, text: '{"verdict":"approve"}', model: 'gemini-3.8-flash' });
  assert.equal(geminiReply(lines(init, { event: 'result', result: { ...result.result, denied_actions: [{ action: 'command' }] } })).ok, false);
  assert.equal(geminiReply(lines(init, { event: 'result', result: { ...result.result, status: 'FAILED' } })).ok, false);
  assert.equal(geminiReply(lines(init, { event: 'result', result: { ...result.result, denied_actions: [{ action: 'command' }] } }, result)).ok, false);
  assert.equal(geminiReply(lines(init)).ok, false);
  assert.equal(geminiReply(lines(result)).ok, false);
});

test('a full Gemini review is sent in bounded parts in one conversation without losing diff bytes', () => {
  const prompt = `role and card\n${'diff line\n'.repeat(15_000)}end marker\n`;
  const messages = geminiMessages(prompt).trim().split('\n').map(JSON.parse);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.event === 'user'));
  const restored = messages.map((message) => message.message.content.split('\n\n').slice(1).join('\n\n')).join('');
  assert.equal(restored, prompt);
  assert.ok(messages.every((message) => Buffer.byteLength(message.message.content) < 91_000));
  assert.deepEqual(geminiMessages('small\n').trim().split('\n').map(JSON.parse),
    [{ event: 'user', message: { content: 'small\n' } }]);
});

test('the Gemini launcher writes the bounded stream to its contained process', async () => {
  let sent;
  const prompt = `role\n${'diff line\n'.repeat(15_000)}end marker\n`;
  await review({ reviewer: 'gemini', model: 'gemini-3.8-flash', prompt }, {
    contain: FREE,
    run: async (_command, _args, _options, limits) => {
      limits.started({ stdout: new EventEmitter(), stderr: new EventEmitter(),
        stdin: { end: (value) => { sent = value; } }, on: () => {} });
      return { code: 1 };
    },
  });
  assert.ok(sent.split('\n').filter(Boolean).length > 1);
  assert.equal(sent.split('\n').filter(Boolean).map((line) => JSON.parse(line).message.content.split('\n\n').slice(1).join('\n\n')).join(''), prompt);
});

test('Gemini review starts in a read-only transient service with no access to candidate files', async () => {
  let seen;
  const reply = await review({ reviewer: 'gemini', prompt: 'the full brief' }, {
    contain: FREE,
    run: async (command, args, options) => { seen = { command, args, options }; return { stopped: true }; },
  });
  assert.equal(reply.status, 'stopped');
  assert.equal(seen.command, 'systemd-run');
  assert.ok(seen.args.includes('-p'));
  assert.ok(seen.args.includes('ProtectSystem=strict'));
  assert.ok(seen.args.includes('InaccessiblePaths=/srv/julia-runner'));
  assert.ok(seen.args.includes('ReadWritePaths=/home/gemini-worker'));
  assert.ok(seen.args.includes('--working-directory=/home/gemini-worker'));
  assert.ok(seen.args.some((arg) => arg.endsWith('.service')));
  assert.equal(seen.options.cwd, '/');
  assert.ok(REVIEWERS.gemini('brief').args.includes('stream-json'));
  assert.ok(REVIEWERS.gemini('brief').args.includes('--input-format'));
  assert.equal(REVIEWERS.gemini('brief').streamPrompt, true);
  assert.ok(!REVIEWERS.gemini('brief').args.includes('brief'));
  assert.ok(!REVIEWERS.gemini('brief').args.includes('--dangerously-skip-permissions'));
});

test('Codex: the last agent message of a completed turn is the reply; a failed turn is not', () => {
  const done = lines({ type: 'thread.started', thread_id: 't1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'first' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"approve"}' } }, { type: 'turn.completed', usage: {} });
  assert.deepEqual(codexReply(done), { ok: true, text: '{"verdict":"approve"}', thread: 't1' });
  const failed = lines({ type: 'thread.started', thread_id: 't2' }, { type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"approve"}' } },
    { type: 'turn.failed', error: { message: 'usage limit' } });
  assert.equal(codexReply(failed).ok, false);
  assert.equal(codexReply(failed).error, 'usage limit');
  assert.equal(codexReply(lines({ type: 'thread.started', thread_id: 't3' })).error, 'the turn did not complete');
});

test('Codex: the model that ran is read from its own session log, for exactly its thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  try {
    mkdirSync(join(root, '2026', '09', '25'), { recursive: true });
    writeFileSync(join(root, '2026', '09', '25', 'rollout-2026-09-25T12-07-16-abc.jsonl'), lines(
      { type: 'session_meta', payload: { model_provider: 'openai' } }, { type: 'turn_context', payload: { model: 'gpt-5.5', cwd: '/' } }));
    const quick = { root, pause: 1 };
    assert.equal(await codexModel('abc', quick), 'gpt-5.5');
    assert.equal(await codexModel('bc', quick), null); // a thread whose id only ends the same is not this one
    assert.equal(await codexModel('other', quick), null);
    assert.equal(await codexModel(null, quick), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Pi: the final message is the last message_end that ended the turn, from a real stream', () => {
  const real = piReply(readFileSync(PI_FIXTURE, 'utf8'));
  assert.equal(real.ok, true);
  assert.match(real.text, /julia-next/);
  // the same run cut before its last message: the turn ended in a tool call, so there is no final message
  const cut = readFileSync(PI_FIXTURE, 'utf8').split('\n').filter((line) => !line.includes('"stopReason":"stop"')).join('\n');
  assert.equal(piReply(cut).ok, false);
  assert.equal(piReply(cut).error, 'the reviewer did not finish its turn');
  // Pi's agent_end repeats the last message without its text (run-pi-seat.test.mjs)
  const stream = lines({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', model: 'deepseek/deepseek-v4-pro', content: [{ type: 'text', text: 'the verdict' }] } },
    { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] });
  assert.deepEqual(piReply(stream), { ok: true, text: 'the verdict', model: 'deepseek/deepseek-v4-pro' });
  const limited = lines({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [], errorMessage: '429: weekly usage limit' } });
  assert.equal(piReply(limited).ok, false);
  assert.match(piReply(limited).error, /weekly usage limit/);
});

test('an unknown reviewer or an empty prompt is refused before anything starts', async () => {
  const run = () => assert.fail('nothing may start');
  assert.match((await review({ reviewer: 'grok', prompt: 'x' }, { run })).error, /unknown reviewer/);
  assert.match((await review({ reviewer: 'codex', prompt: ' ' }, { run })).error, /no prompt/);
});

const fakeRun = (result, stdout = '', exit = null) => async (command, args, options, { seconds, started }) => {
  const child = {
    pid: 4242, stdout: { on: (e, f) => f(stdout) }, stderr: { on: () => {} }, stdin: { end: () => {} },
    on: (event, f) => { if (event === 'exit' && exit) f(...exit); },
  };
  started(child);
  return { seconds, options, ...result };
};

test('each review runs in its own systemd user scope, and none starts without a user manager', async () => {
  let seen;
  await review({ reviewer: 'codex', prompt: 'p' }, { run: async (command, args, options) => { seen = { command, args, options }; return { stopped: true }; }, contain: FREE });
  assert.equal(seen.command, 'systemd-run');
  const unit = seen.args.find((a) => a.startsWith('--unit=')).slice('--unit='.length);
  assert.match(unit, new RegExp(`^${SCOPE_PREFIX}[0-9a-f-]{36}\\.scope$`));
  assert.deepEqual(seen.args.slice(0, 4), ['--user', '--scope', '--quiet', '--collect']);
  assert.deepEqual(seen.args.slice(seen.args.indexOf('--'), seen.args.indexOf('--') + 5), ['--', PYTHON, REAPER, '--', 'codex']);
  assert.equal(seen.options.env.XDG_RUNTIME_DIR, '/run/user/1');
  // no user manager: refused, and nothing starts
  const none = await review({ reviewer: 'codex', prompt: 'p' }, { run: () => assert.fail('nothing may start'), contain: { manager: () => null, stop: async () => [] } });
  assert.equal(none.status, 'failed');
  assert.match(none.error, /no systemd user manager/);
  // a user manager is found by its private socket
  assert.deepEqual(userManager({ uid: 1001, exists: (path) => path === '/run/user/1001/systemd/private' }), { XDG_RUNTIME_DIR: '/run/user/1001' });
  assert.equal(userManager({ uid: 1001, exists: () => false }), null);
});

test('stopping a scope kills what is in it, pass after pass, until it is empty or gone', async () => {
  // a process that forks once as it is killed: the second pass catches its child
  let procs = [10];
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args.slice(1, 3).join(' '));
    if (args[1] === 'kill') procs = procs[0] === 10 ? [11] : [];
    return { stdout: args[1] === 'show' ? '/user.slice/app.slice/julia-review-x.scope\n' : '' };
  };
  const read = () => procs.join('\n');
  assert.deepEqual(await stopScope('julia-review-x.scope', { run, read, pause: 1 }), []);
  assert.deepEqual(calls.filter((c) => c.startsWith('kill')), ['kill --signal=SIGKILL', 'kill --signal=SIGKILL']);
  // a scope already gone has nothing left
  assert.deepEqual(await stopScope('julia-review-y.scope', { run: () => ({ stdout: '' }), read }), []);
  // what will not die is returned after the last pass
  assert.deepEqual(await stopScope('julia-review-z.scope', { run: () => ({ stdout: '/x.scope' }), read: () => '42\n', passes: 3, pause: 1 }), [42]);
});

test('a run that leaves something in its scope that nothing could stop is never a clean reply', async () => {
  const reply = await review({ reviewer: 'codex', prompt: 'p' }, {
    run: fakeRun({ code: 0 }, lines({ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { type: 'agent_message', text: 'v' } }, { type: 'turn.completed' })),
    model: () => 'gpt-5.5', contain: { ...FREE, stop: async () => [777] },
  });
  assert.equal(reply.status, 'failed');
  assert.match(reply.error, /left 1 process\(es\) running that could not be stopped: 777/);
});

test('if the reaper itself is killed outright, the rest of its group is killed at once', async () => {
  const killed = [];
  const kill = (pid, signal) => killed.push([pid, signal]);
  let stopped = 0;
  const contain = { ...FREE, stop: async () => { stopped += 1; return []; } };
  const reply = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ code: null, signal: 'SIGKILL' }, '', [null, 'SIGKILL']), kill, model: () => null, contain });
  assert.equal(stopped, 2, 'the scope is stopped at once, and again when the run ends');
  assert.deepEqual(killed, [[-4242, 'SIGKILL']]);
  assert.equal(reply.status, 'failed');
  assert.match(reply.error, /^the reviewer was stopped by SIGKILL(: |$)/);
  killed.length = 0;
  await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ code: 0 }, '', [0, null]), kill, model: () => 'gpt-5.5', contain: FREE });
  assert.deepEqual(killed, [], 'a reaper that ended by itself has already swept');
});

test('the reviewer runs under its reaper from /, and a stop, a crash, an abnormal exit or an unconfirmed model is never an ok reply', async () => {
  let seen;
  const run = async (command, args, options, limits) => { seen = { command, args, options, seconds: limits.seconds }; return fakeRun({ code: 0 }, lines({ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { type: 'agent_message', text: 'v' } }, { type: 'turn.completed' }))(command, args, options, limits); };
  const ok = await review({ reviewer: 'codex', prompt: 'p', limit_seconds: 99999 }, { run, model: () => 'gpt-5.5', contain: FREE });
  assert.deepEqual(ok, { status: 'ok', text: 'v', model: 'gpt-5.5' });
  assert.equal(seen.options.cwd, '/');
  assert.equal(seen.seconds, 3600); // capped
  assert.deepEqual(seen.args.slice(seen.args.indexOf('--') + 1, seen.args.indexOf('--') + 5), [PYTHON, REAPER, '--', 'codex']);
  const unconfirmed = await review({ reviewer: 'codex', prompt: 'p' }, { run, model: () => null, contain: FREE });
  assert.equal(unconfirmed.status, 'failed');
  assert.match(unconfirmed.error, /model that ran could not be confirmed/);
  assert.equal((await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ stopped: true }), contain: FREE })).status, 'stopped');
  const crashed = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ code: 137 }, lines({ type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"approve"}' } }, { type: 'turn.completed' })), model: () => null, contain: FREE });
  assert.equal(crashed.status, 'failed');
  assert.match(crashed.error, /exited 137/);
  const noStart = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ error: new Error('spawn codex ENOENT') }), contain: FREE });
  assert.match(noStart.error, /did not start: spawn codex ENOENT/);
});

// Real processes: whatever the reviewer starts is stopped with it, even a
// process that left its group (setsid) or was orphaned by a double fork.
// Each test has a timeout, and cleans up what its pretend reviewer made even when it fails,
// so a broken stop can never leave processes running on the machine.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const linuxOnly = { skip: process.platform === 'win32' ? 'process groups and subreapers: Linux only' : false, timeout: 60_000 };
// The real reviews run in a systemd user scope, which needs this account's user
// manager: orchestrator-svc has one on the server; the test worker's account does not.
const contained = { ...linuxOnly, skip: linuxOnly.skip || (userManager() ? false : 'no systemd user manager for this account') };
const settle = () => new Promise((r) => setTimeout(r, 500));
const pidsIn = (...files) => files.flatMap((file) => { try { return readFileSync(file, 'utf8').split('\n').map(Number).filter(Boolean); } catch { return []; } });
const killAll = (pids) => { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };

// A pretend reviewer (a shell script) that starts a plain child, one that escapes its
// process group with setsid, and one orphaned by a double fork, writes their pids, then
// either waits or ends at once.
function fakeReviewer(dir, { endAtOnce = false } = {}) {
  const script = join(dir, 'codex');
  writeFileSync(script, [
    '#!/bin/sh',
    'sleep 60 & echo $! > "$0.plain"',
    'setsid sleep 60 & echo $! > "$0.escaped"',
    '( sleep 60 & echo $! > "$0.orphan" ) &',
    'while [ ! -s "$0.orphan" ]; do sleep 0.05; done',
    'echo ready > "$0.ready"',
    endAtOnce ? 'exit 0' : 'wait',
    '',
  ].join('\n'), { mode: 0o755 });
  const pids = () => ['plain', 'escaped', 'orphan'].map((kind) => Number(readFileSync(`${script}.${kind}`, 'utf8').trim()));
  const ready = () => { try { return readFileSync(`${script}.ready`, 'utf8').includes('ready'); } catch { return false; } };
  const cleanup = () => killAll(pidsIn(`${script}.plain`, `${script}.escaped`, `${script}.orphan`));
  return { script, pids, ready, cleanup };
}

test('a child that ignores SIGTERM and keeps forking while being stopped is stopped with everything it made', contained, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const script = join(dir, 'codex');
  writeFileSync(script, [
    '#!/bin/sh',
    // a detached forker: ignores SIGTERM and starts a new sleeper every 20 ms, well past the 2 s
    // limit; it is bounded (200 sleepers of 30 s) so a broken stop cannot flood the machine
    `setsid sh -c 'trap "" TERM; echo $$ > "${script}.forker"; i=0; while [ $i -lt 200 ]; do sleep 30 & echo $! >> "${script}.forks"; i=$((i+1)); sleep 0.02; done; wait' &`,
    `while [ ! -s "${script}.forks" ]; do sleep 0.05; done`,
    'wait',
    '',
  ].join('\n'), { mode: 0o755 });
  const reviewers = { fake: () => ({ command: script, args: [], env: process.env, stdin: false }) };
  try {
    const reply = await review({ reviewer: 'fake', prompt: 'p', limit_seconds: 2 }, { reviewers });
    assert.equal(reply.status, 'stopped');
    await settle();
    const made = [readFileSync(`${script}.forker`, 'utf8'), ...readFileSync(`${script}.forks`, 'utf8').split('\n')].map(Number).filter(Boolean);
    assert.ok(made.length > 5, `the forker made ${made.length} processes`);
    const left = made.filter(alive);
    assert.deepEqual(left, [], `${left.length} of the ${made.length} processes the forker made outlived the stop`);
  } finally {
    killAll(pidsIn(`${script}.forker`, `${script}.forks`));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('at its limit the whole reviewer is stopped, escaped and orphaned children included', contained, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const fake = fakeReviewer(dir);
  const reviewers = { fake: () => ({ command: fake.script, args: [], env: process.env, stdin: false }) };
  try {
    const reply = await review({ reviewer: 'fake', prompt: 'p', limit_seconds: 2 }, { reviewers });
    assert.equal(reply.status, 'stopped');
    assert.ok(fake.ready(), 'the pretend reviewer started its children before the limit');
    await settle();
    for (const pid of fake.pids()) assert.equal(alive(pid), false, `child ${pid} outlived the limit`);
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reviewer that ends leaves nothing running behind it', contained, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const fake = fakeReviewer(dir, { endAtOnce: true });
  const reviewers = { fake: () => ({ command: fake.script, args: [], env: process.env, stdin: false }) };
  try {
    const reply = await review({ reviewer: 'fake', prompt: 'p', limit_seconds: 30 }, { reviewers });
    assert.equal(reply.status, 'failed'); // no final message: never a review
    await settle();
    for (const pid of fake.pids()) assert.equal(alive(pid), false, `child ${pid} outlived the reviewer`);
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a reviewer left behind by a reaper killed outright is stopped, even a helper that left the group and wiped its environment', contained, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const script = join(dir, 'codex');
  // a pretend reviewer with a plain child, a double-fork orphan, a helper that left the group
  // (setsid), and one that left the group with an empty environment (Codex review, round 11)
  writeFileSync(script, [
    '#!/bin/sh',
    `sleep 60 & echo $! > "${script}.plain"`,
    `( sleep 60 & echo $! > "${script}.orphan" ) &`,
    `setsid sleep 60 & echo $! > "${script}.escaped"`,
    `setsid env -i sleep 60 & echo $! > "${script}.wiped"`,
    `while [ ! -s "${script}.orphan" ] || [ ! -s "${script}.escaped" ] || [ ! -s "${script}.wiped" ]; do sleep 0.05; done`,
    'wait', '',
  ].join('\n'), { mode: 0o755 });
  const reviewers = { fake: () => ({ command: script, args: [], env: process.env, stdin: false }) };
  let reaper;
  const run = (command, args, options, limits) => runLimited(command, args, options, {
    ...limits, started: (child) => { reaper = child.pid; limits.started(child); },
  });
  try {
    const pending = review({ reviewer: 'fake', prompt: 'p', limit_seconds: 40 }, { run, reviewers });
    for (let i = 0; i < 100 && pidsIn(`${script}.orphan`, `${script}.escaped`, `${script}.wiped`).length < 3; i += 1) await new Promise((r) => setTimeout(r, 100));
    process.kill(reaper, 'SIGKILL'); // as the kernel's out-of-memory killer would
    const reply = await pending;
    assert.equal(reply.status, 'failed');
    assert.match(reply.error, /stopped by SIGKILL/);
    await settle();
    const made = pidsIn(`${script}.plain`, `${script}.orphan`, `${script}.escaped`, `${script}.wiped`);
    assert.equal(made.length, 4);
    for (const pid of made) assert.equal(alive(pid), false, `child ${pid} outlived its reaper`);
  } finally {
    killAll(pidsIn(`${script}.plain`, `${script}.orphan`, `${script}.escaped`, `${script}.wiped`));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when the graph stops the launcher, everything the reviewer started stops too', contained, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const fake = fakeReviewer(dir);
  try {
    const launcher = spawn(process.execPath, [LAUNCHER], { env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` }, stdio: ['pipe', 'pipe', 'pipe'] });
    launcher.stdin.end(JSON.stringify({ reviewer: 'codex', prompt: 'p', limit_seconds: 60 }));
    for (let i = 0; i < 100 && !fake.ready(); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fake.ready(), 'the pretend reviewer started its children');
    for (const pid of fake.pids()) assert.ok(alive(pid), `child ${pid} started`);
    const code = await new Promise((r) => { launcher.on('close', r); launcher.kill('SIGTERM'); });
    assert.equal(code, 124);
    await settle();
    for (const pid of fake.pids()) assert.equal(alive(pid), false, `child ${pid} outlived the graph's stop`);
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
