// The graph's reviewer launcher (JUL-128): ops/julia-runner/run-reviewer.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codexModel, codexReply, piReply, PYTHON, REAPER, REVIEWERS, review } from '../ops/julia-runner/run-reviewer.mjs';

const LAUNCHER = fileURLToPath(new URL('../ops/julia-runner/run-reviewer.mjs', import.meta.url));
const PI_FIXTURE = fileURLToPath(new URL('../graph/fixtures/orca-1.4.205/cost.pi.seat-json-stream.multi-turn.jsonl', import.meta.url));
const lines = (...events) => events.map((e) => JSON.stringify(e)).join('\n');

test('Codex is started read-only, on the pinned model, with the prompt on stdin', () => {
  const spec = REVIEWERS.codex('the brief');
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args, ['exec', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort=high', '-s', 'read-only', '--skip-git-repo-check', '--json', '-']);
  assert.equal(spec.stdin, true);
  assert.deepEqual(Object.keys(spec.env).sort(), ['HOME', 'LANG', 'PATH']);
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

const fakeRun = (result, stdout = '') => async (command, args, options, { seconds, started }) => {
  const child = { stdout: { on: (e, f) => f(stdout) }, stderr: { on: () => {} }, stdin: { end: () => {} } };
  started(child);
  return { seconds, options, ...result };
};

test('the reviewer runs under its reaper from /, and a stop, a crash, an abnormal exit or an unconfirmed model is never an ok reply', async () => {
  let seen;
  const run = async (command, args, options, limits) => { seen = { command, args, options, seconds: limits.seconds }; return fakeRun({ code: 0 }, lines({ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { type: 'agent_message', text: 'v' } }, { type: 'turn.completed' }))(command, args, options, limits); };
  const ok = await review({ reviewer: 'codex', prompt: 'p', limit_seconds: 99999 }, { run, model: () => 'gpt-5.5' });
  assert.deepEqual(ok, { status: 'ok', text: 'v', model: 'gpt-5.5' });
  assert.equal(seen.options.cwd, '/');
  assert.equal(seen.seconds, 3600); // capped
  assert.deepEqual([seen.command, ...seen.args.slice(0, 3)], [PYTHON, REAPER, '--', 'codex']);
  const unconfirmed = await review({ reviewer: 'codex', prompt: 'p' }, { run, model: () => null });
  assert.equal(unconfirmed.status, 'failed');
  assert.match(unconfirmed.error, /model that ran could not be confirmed/);
  assert.equal((await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ stopped: true }) })).status, 'stopped');
  const crashed = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ code: 137 }, lines({ type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"approve"}' } }, { type: 'turn.completed' })), model: () => null });
  assert.equal(crashed.status, 'failed');
  assert.match(crashed.error, /exited 137/);
  const noStart = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ error: new Error('spawn codex ENOENT') }) });
  assert.match(noStart.error, /did not start: spawn codex ENOENT/);
});

// Real processes: whatever the reviewer starts is stopped with it, even a
// process that left its group (setsid) or was orphaned by a double fork.
// Each test has a timeout, and cleans up what its pretend reviewer made even when it fails,
// so a broken stop can never leave processes running on the machine.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const linuxOnly = { skip: process.platform === 'win32' ? 'process groups and subreapers: Linux only' : false, timeout: 60_000 };
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

test('a child that ignores SIGTERM and keeps forking while being stopped is stopped with everything it made', linuxOnly, async () => {
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

test('at its limit the whole reviewer is stopped, escaped and orphaned children included', linuxOnly, async () => {
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

test('a reviewer that ends leaves nothing running behind it', linuxOnly, async () => {
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

test('when the graph stops the launcher, everything the reviewer started stops too', linuxOnly, async () => {
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
