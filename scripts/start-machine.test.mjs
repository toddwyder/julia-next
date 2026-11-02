import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseArgs, readState, startMachine } from './start-machine.mjs';

// Each stage is a real program on disk that takes the machine's arguments and
// answers with an exit code, so these runs exercise the real process handling.
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'start-machine-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const program = (name, body) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };
  const marks = path.join(root, 'marks');
  fs.writeFileSync(marks, '');
  const env = {
    START_MACHINE_BUILD: program('build', `echo build >> ${marks}`),
    START_MACHINE_FIND_PR: program('find-pr', 'echo 42'),
    START_MACHINE_REMEDIATION: program('remediation', `echo remediation >> ${marks}`),
    START_MACHINE_MERGE: program('merge', `echo merge >> ${marks}`),
  };
  const ran = () => fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean);
  return { root, bin, env, program, ran };
}

test('a card goes through build, review and merge and ends Complete', () => {
  const w = workspace();
  const result = startMachine({ card: 'JUL-900' }, { root: w.root, env: w.env, log: () => {} });
  assert.equal(result.code, 0);
  assert.deepEqual(w.ran(), ['build', 'remediation', 'merge']);
  const state = readState('JUL-900', w.root);
  assert.equal(state.pr, 42);
  assert.equal(state.merge.status, 'done');
});

test('a review loop that stops the card keeps the merge from running', () => {
  const w = workspace();
  w.env.START_MACHINE_REMEDIATION = w.program('remediation-fails', 'exit 1');
  const result = startMachine({ card: 'JUL-901' }, { root: w.root, env: w.env, log: () => {} });
  assert.equal(result.code, 1);
  assert.equal(result.stage, 'remediation');
  assert.deepEqual(w.ran(), ['build']);
});

test('a second run continues after the stage that stopped and does not build again', () => {
  const w = workspace();
  const failing = w.program('remediation-fails', 'exit 1');
  startMachine({ card: 'JUL-902' }, { root: w.root, env: { ...w.env, START_MACHINE_REMEDIATION: failing }, log: () => {} });
  const result = startMachine({ card: 'JUL-902' }, { root: w.root, env: w.env, log: () => {} });
  assert.equal(result.code, 0);
  assert.deepEqual(w.ran(), ['build', 'remediation', 'merge']);
});

test('a finished card is not merged twice', () => {
  const w = workspace();
  startMachine({ card: 'JUL-903' }, { root: w.root, env: w.env, log: () => {} });
  startMachine({ card: 'JUL-903' }, { root: w.root, env: w.env, log: () => {} });
  assert.deepEqual(w.ran(), ['build', 'remediation', 'merge']);
});

test('a builder that leaves no pull request stops the machine at the pull request', () => {
  const w = workspace();
  w.env.START_MACHINE_FIND_PR = w.program('find-none', 'exit 1');
  const result = startMachine({ card: 'JUL-904' }, { root: w.root, env: w.env, log: () => {} });
  assert.equal(result.code, 1);
  assert.equal(result.stage, 'pr');
  assert.deepEqual(w.ran(), ['build']);
});

test('--pr skips the build', () => {
  const w = workspace();
  const result = startMachine({ card: 'JUL-905', pr: 7 }, { root: w.root, env: w.env, log: () => {} });
  assert.equal(result.code, 0);
  assert.deepEqual(w.ran(), ['remediation', 'merge']);
});

test('arguments: a card id is required in the JUL-n form', () => {
  assert.equal(parseArgs(['jul-12']).card, 'JUL-12');
  assert.throws(() => parseArgs(['nonsense']));
});
