import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { missingProgram } from './shipping/harness.mjs';
import { parseArgs } from './run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '.artifacts', 'machine');
const missing = missingProgram();
const skip = missing ? `the installed Mastra Code program is incomplete: ${missing}` : false;

// A run keeps its evidence under .artifacts/machine/<run id>. Test files in
// this suite start runs of their own at the same time, so a test removes the
// runs for its own cards and leaves every other card's evidence alone.
function removeRunsFor(cards) {
  const endings = cards.map(card => `-${card}`);
  let names;
  try {
    names = readdirSync(evidence);
  } catch {
    return;
  }
  for (const name of names) {
    if (endings.some(ending => name.endsWith(ending))) rmSync(path.join(evidence, name), { recursive: true, force: true });
  }
}

// Each stage is a real program on disk that exits with a code, so a run here
// exercises the entry point, the workflow and the record together.
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'machine-run-'));
  const program = (name, body) => {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };
  return {
    dir,
    env: {
      ...process.env,
      MACHINE_RUNS_DIR: path.join(dir, 'runs'),
      MACHINE_BUILD: program('build', 'exit 0'),
      MACHINE_FIND_PR: program('find-pr', 'echo 431'),
      MACHINE_REMEDIATION: program('remediation', 'exit 0'),
      MACHINE_LANDING: program('landing', 'exit 0'),
    },
  };
}

function runs(dir) {
  const folder = path.join(dir, 'runs');
  const files = readdirSync(folder);
  assert.equal(files.length, 1, 'one run, one record');
  return JSON.parse(readFileSync(path.join(folder, files[0]), 'utf8'));
}

test('the machine takes a card, an existing pull request and a review model', () => {
  assert.deepEqual(parseArgs(['jul-330']), { card: 'JUL-330', pr: null, model: null, dryRun: false, help: false });
  assert.equal(parseArgs(['JUL-330', '--pr', '431']).pr, 431);
  assert.equal(parseArgs(['JUL-330', '--model', 'a/model']).model, 'a/model');
  assert.equal(parseArgs(['JUL-330', '--dry-run']).dryRun, true);
  assert.throws(() => parseArgs(['nonsense']), /unknown argument/);
  assert.throws(() => parseArgs(['JUL-330', '--bogus']), /unknown argument/);
});

test('--dry-run prints the three stage commands and runs none of them', () => {
  const output = execFileSync(process.execPath, ['machine/run.mjs', 'JUL-330', '--dry-run'], { cwd: root, encoding: 'utf8' });
  const lines = output.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^build: mastracode -p <kickoff prompt>$/);
  assert.match(lines[1], /^remediation: node scripts\/julia-agents\.mjs -- node machine\/remediation\/run\.mjs --pr <n> --card JUL-330$/);
  assert.match(lines[2], /^landing: node scripts\/julia-agents\.mjs -- node machine\/merge\/run\.mjs --pr <n> --card JUL-330$/);
});

test('a call with no card is a usage error, not a run', () => {
  try {
    execFileSync(process.execPath, ['machine/run.mjs'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected a usage error');
  } catch (error) {
    assert.equal(error.status, 2);
    assert.match(String(error.stderr), /Usage: node machine\/run\.mjs/);
  }
});

test('one run of the machine records build, review and landing in that order', { skip }, () => {
  const w = workspace();
  try {
    const output = execFileSync(process.execPath, ['machine/run.mjs', 'JUL-330'], { cwd: root, env: w.env, encoding: 'utf8', timeout: 120_000 });
    const record = runs(w.dir);

    assert.match(output, /machine: build succeeded/);
    assert.match(output, /machine: remediation succeeded/);
    assert.match(output, /machine: landing succeeded/);
    assert.equal(record.card, 'JUL-330');
    assert.equal(record.pr, 431);
    assert.equal(record.status, 'succeeded');
    assert.deepEqual(record.steps.map(step => [step.id, step.status]), [
      ['build', 'succeeded'],
      ['remediation', 'succeeded'],
      ['landing', 'succeeded'],
    ]);
    assert.ok(record.workflowRunId, 'the run points at the workflow run that produced it');
  } finally {
    removeRunsFor(['JUL-330']);
  }
});

test('a stage that stops the card ends the run, and the later stages never start', { skip }, () => {
  const w = workspace();
  w.env.MACHINE_REMEDIATION = path.join(w.dir, 'remediation-fails');
  writeFileSync(w.env.MACHINE_REMEDIATION, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  try {
    let thrown;
    try {
      execFileSync(process.execPath, ['machine/run.mjs', 'JUL-330'], { cwd: root, env: w.env, encoding: 'utf8', timeout: 120_000 });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown?.status, 1);
    assert.match(String(thrown.stderr), /failed at remediation/);

    const record = runs(w.dir);
    assert.equal(record.status, 'failed');
    assert.deepEqual(record.steps.map(step => [step.id, step.status]), [
      ['build', 'succeeded'],
      ['remediation', 'failed'],
      ['landing', 'pending'],
    ]);
  } finally {
    removeRunsFor(['JUL-330']);
  }
});
