import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agyOutcome, agyStepLine, deepseekAdapter, geminiAdapter, lastAssistantText, readAppCredential, sudoCommand, testerAdapter, WORKERS,
} from './julia-minimal-runner-adapters.mjs';

// The server split (JUL-122, Todd 24 Sep): the runner (orchestrator-svc) holds
// the Linear app credential; Gemini edits as gemini-worker; a non-LLM test
// worker runs tests as julia-tester; DeepSeek reviews as runner. Each worker
// is started through sudo with one fixed, root-owned command and an
// environment that carries nothing of the runner's.

// A stand-in for the streaming spawn: records the call, answers like the worker.
function recordingRun(reply = { status: 0, stdout: '', stderr: '' }) {
  const calls = [];
  const run = async (command, args, options) => { calls.push({ command, args, options }); return { error: null, ...reply }; };
  return { run, calls };
}

const ONLY_SAFE_ENV = (env) => assert.deepEqual(Object.keys(env).sort(), ['LANG', 'PATH'], 'the worker gets PATH and LANG only, never the runner\'s environment');

test('each worker runs as its own account through one fixed sudo command', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(WORKERS).map(([worker, { account }]) => [worker, account])), { gemini: 'gemini-worker', tests: 'julia-tester', review: 'runner' });
  assert.deepEqual(sudoCommand('gemini'), ['-n', '-u', 'gemini-worker', '--', '/usr/bin/node', '/opt/julia-runner/ops/julia-runner/run-gemini.mjs']);
  assert.deepEqual(sudoCommand('tests'), ['-n', '-u', 'julia-tester', '--', '/usr/bin/node', '/opt/julia-runner/ops/julia-runner/run-tests.mjs']);
  assert.deepEqual(sudoCommand('review'), ['-n', '-u', 'runner', '--', '/usr/bin/node', '/opt/julia-runner/ops/service-dropbox/run-pi-seat.mjs', 'reviewer-backup', '--effort', 'high']);
});

test('Gemini gets the worktree and the brief on stdin, and nothing of the runner\'s environment', async () => {
  const { run, calls } = recordingRun({ status: 0, stdout: JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }) });
  process.env.CREDENTIALS_DIRECTORY = '/run/credentials/julia-runner.service';
  try {
    const turn = await geminiAdapter({ run })('the brief', { cwd: '/srv/julia-runner/worktrees/card-9' });
    assert.deepEqual(turn, { ok: true, reason: null, text: 'Done.' });
  } finally {
    delete process.env.CREDENTIALS_DIRECTORY;
  }
  assert.equal(calls[0].command, 'sudo');
  assert.deepEqual(calls[0].args, sudoCommand('gemini'));
  assert.deepEqual(JSON.parse(calls[0].options.input), { worktree: '/srv/julia-runner/worktrees/card-9', prompt: 'the brief' });
  ONLY_SAFE_ENV(calls[0].options.env);
});

test('the test worker gets only the test request, and its JSON answer comes back', async () => {
  const { run, calls } = recordingRun({ status: 0, stdout: JSON.stringify({ status: 1, output: 'not ok 1' }) });
  const result = await testerAdapter({ run })({ worktree: '/srv/julia-runner/worktrees/card-9', run: 'files', files: ['scripts/a.test.mjs'] });
  assert.deepEqual(result, { status: 1, output: 'not ok 1' });
  assert.deepEqual(calls[0].args, sudoCommand('tests'));
  assert.deepEqual(JSON.parse(calls[0].options.input), { worktree: '/srv/julia-runner/worktrees/card-9', run: 'files', files: ['scripts/a.test.mjs'] });
  ONLY_SAFE_ENV(calls[0].options.env);
});

test('a test worker that fails to answer is a failed run, never a pass', async () => {
  const { run } = recordingRun({ status: 1, stdout: '', stderr: 'sudo: a password is required' });
  const result = await testerAdapter({ run })({ worktree: '/srv/julia-runner/worktrees/card-9', run: 'suite' });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /test worker did not answer.*password is required/s);
});

test('a worker stopped by its time limit (exit 124) is reported as stopped, never as a pass (JUL-126)', async () => {
  const stoppedTests = recordingRun({ status: 124, stdout: '', stderr: 'stopped: ran longer than its 900-second time limit' });
  const tests = await testerAdapter({ run: stoppedTests.run })({ worktree: '/srv/julia-runner/worktrees/card-9', run: 'suite' });
  assert.notEqual(tests.status, 0);
  assert.equal(tests.output, 'the test run was stopped: stopped: ran longer than its 900-second time limit');
  const stoppedGemini = recordingRun({ status: 124, stdout: JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } }), stderr: 'stopped: ran longer than its 3600-second time limit' });
  const turn = await geminiAdapter({ run: stoppedGemini.run })('the brief', { cwd: '/srv/julia-runner/worktrees/card-9' });
  assert.deepEqual(turn, { ok: false, reason: 'the Gemini worker was stopped: stopped: ran longer than its 3600-second time limit' });
});

test('DeepSeek gets the review on stdin as runner, from /, with nothing of the runner\'s environment', async () => {
  const assistant = { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Fine.\nVERDICT: CLEAN' }] } };
  const { run, calls } = recordingRun({ status: 0, stdout: JSON.stringify(assistant) });
  const reply = await deepseekAdapter({ run })('the review brief', { axis: 'spec' });
  assert.deepEqual(reply, { ok: true, text: 'Fine.\nVERDICT: CLEAN' });
  assert.deepEqual(calls[0].args, sudoCommand('review'));
  assert.equal(calls[0].options.input, 'the review brief');
  assert.equal(calls[0].options.cwd, '/');
  ONLY_SAFE_ENV(calls[0].options.env);
});

// -- The Linear app credential: systemd-creds, read in-process, at run time.

test('with no systemd credentials directory the run stops with a clear reason', () => {
  assert.throws(() => readAppCredential({ dir: undefined }), /Linear app credential is not available.*systemd-run.*LoadCredentialEncrypted/s);
});

test('an unreadable credential stops the run, and the error never carries a value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'creds-'));
  writeFileSync(join(dir, 'linear-app-id'), 'client-id-XYZ\n');
  try {
    assert.throws(() => readAppCredential({ dir }), (error) => /could not be read/.test(error.message) && !error.message.includes('client-id-XYZ'));
    writeFileSync(join(dir, 'linear-app-secret'), 'SECRET-abc123\n');
    assert.deepEqual(readAppCredential({ dir }), { clientId: 'client-id-XYZ', clientSecret: 'SECRET-abc123' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- Reading the workers' output.

const stream = (...events) => events.map((e) => JSON.stringify(e)).join('\n');
const activeStep = (tool, parameters) => ({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'tool', tool_name: tool, tool_info: { name: tool, parameters } } });

test('each Gemini tool step becomes one progress line', () => {
  assert.equal(agyStepLine(activeStep('view_file', { AbsolutePath: '/w/scripts/add.mjs' })), 'view_file /w/scripts/add.mjs');
  assert.equal(agyStepLine({ event: 'step_update', step_update: { state: 'DONE', tool_name: 'view_file' } }), null, 'only the start of a step');
  assert.equal(agyStepLine('not json'), null);
});

test('a denied action, an empty reply, a non-SUCCESS status or no result is a failed turn', () => {
  const denied = stream({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } });
  assert.equal(agyOutcome(denied, 'noise\njetski: a tool required the "command" permission\n').reason, 'agy denied command (RunCommand): jetski: a tool required the "command" permission');
  assert.equal(agyOutcome(stream({ event: 'result', result: { status: 'SUCCESS', response: '' } })).ok, false);
  assert.equal(agyOutcome(stream({ event: 'result', result: { status: 'ERROR', error: 'quota' } })).ok, false);
  assert.equal(agyOutcome(stream(activeStep('view_file', {}))).ok, false);
  assert.deepEqual(agyOutcome(stream({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } })), { ok: true, reason: null, text: 'Done.' }, 'the reply text carries the hand-in');
});

test('the reviewer\'s reply is the last assistant message with text', () => {
  const message = (text) => ({ message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } });
  assert.equal(lastAssistantText(stream(message('first'), message('VERDICT: CLEAN'))), 'VERDICT: CLEAN');
  assert.equal(lastAssistantText('no json'), null);
});
