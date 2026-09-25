// The graph's reviewer launcher (JUL-128): ops/julia-runner/run-reviewer.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codexModel, codexReply, piReply, REVIEWERS, review } from '../ops/julia-runner/run-reviewer.mjs';

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

test('Codex: the model that ran is read from its own session log', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  try {
    mkdirSync(join(root, '2026', '09', '25'), { recursive: true });
    writeFileSync(join(root, '2026', '09', '25', 'rollout-2026-09-25T12-07-16-abc.jsonl'), lines(
      { type: 'session_meta', payload: { model_provider: 'openai' } }, { type: 'turn_context', payload: { model: 'gpt-5.5', cwd: '/' } }));
    assert.equal(codexModel('abc', { root }), 'gpt-5.5');
    assert.equal(codexModel('other', { root }), null);
    assert.equal(codexModel(null, { root }), null);
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

test('the reviewer runs from /, and a stop, a crash or an abnormal exit is never an ok reply', async () => {
  let seen;
  const run = async (command, args, options, limits) => { seen = { options, seconds: limits.seconds }; return fakeRun({ code: 0 }, lines({ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { type: 'agent_message', text: 'v' } }, { type: 'turn.completed' }))(command, args, options, limits); };
  const ok = await review({ reviewer: 'codex', prompt: 'p', limit_seconds: 99999 }, { run, model: () => 'gpt-5.5' });
  assert.deepEqual(ok, { status: 'ok', text: 'v', model: 'gpt-5.5' });
  assert.equal(seen.options.cwd, '/');
  assert.equal(seen.seconds, 3600); // capped
  assert.equal((await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ stopped: true }) })).status, 'stopped');
  const crashed = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ code: 137 }, lines({ type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"approve"}' } }, { type: 'turn.completed' })), model: () => null });
  assert.equal(crashed.status, 'failed');
  assert.match(crashed.error, /exited 137/);
  const noStart = await review({ reviewer: 'codex', prompt: 'p' }, { run: fakeRun({ error: new Error('spawn codex ENOENT') }) });
  assert.match(noStart.error, /did not start: spawn codex ENOENT/);
});

// Real processes: a reviewer whose own child keeps running is stopped with it.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const linuxOnly = { skip: process.platform === 'win32' ? 'process groups: Linux only' : false };

test('at its limit the whole reviewer is stopped, its children included', linuxOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const pidFile = join(dir, 'child.pid');
  const reviewers = { fake: () => ({ command: process.execPath, args: ['-e', `const c=require('child_process').spawn('sleep',['60'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},60000)`], env: process.env, stdin: false }) };
  try {
    const reply = await review({ reviewer: 'fake', prompt: 'p', limit_seconds: 1 }, { reviewers });
    assert.equal(reply.status, 'stopped');
    const child = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(alive(child), false, `the reviewer's own child ${child} outlived the stop`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when the graph stops the launcher, everything it started stops too', linuxOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-'));
  const fakeCodex = join(dir, 'codex');
  const pidFile = join(dir, 'child.pid');
  writeFileSync(fakeCodex, `#!/bin/sh\nsleep 60 &\necho $! > ${pidFile}\nwait\n`, { mode: 0o755 });
  try {
    const launcher = spawn(process.execPath, [LAUNCHER], { env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` }, stdio: ['pipe', 'pipe', 'pipe'] });
    launcher.stdin.end(JSON.stringify({ reviewer: 'codex', prompt: 'p', limit_seconds: 60 }));
    // wait for the fake reviewer's child to exist (an empty file is not a pid: kill(0) means "my own group")
    const childPid = () => Number(readFileSync(pidFile, { encoding: 'utf8', flag: 'a+' }).trim()) || null;
    for (let i = 0; i < 100 && !childPid(); i += 1) await new Promise((r) => setTimeout(r, 100));
    const child = childPid();
    assert.ok(child && alive(child), 'the fake reviewer started its child');
    const code = await new Promise((r) => { launcher.on('close', r); launcher.kill('SIGTERM'); });
    assert.equal(code, 124);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(alive(child), false, `the reviewer's child ${child} outlived the graph's stop`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
