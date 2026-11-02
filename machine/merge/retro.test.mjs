import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listChangedFiles, retroOutcome, retroPathFor, retroTask } from './retro.mjs';

function withDoc(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-retro-'));
  const file = path.join(dir, 'jul-310.md');
  if (body !== undefined) fs.writeFileSync(file, body);
  return { dir, file, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const LONG = `${'A retro finding with its evidence. '.repeat(10)}\n`;

test('the retro doc lands where the other retros do', () => {
  assert.equal(retroPathFor('JUL-310'), 'docs/retros/jul-310.md');
});

test('a retro that wrote nothing usable is not a retro', () => {
  const missing = withDoc();
  try {
    const outcome = retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: missing.file, failed: false });
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /wrote no file/);
  } finally {
    missing.clean();
  }

  const thin = withDoc('Too short.\n');
  try {
    const outcome = retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: thin.file, failed: false });
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /too thin/);
  } finally {
    thin.clean();
  }

  const flat = withDoc(`${LONG}${LONG}`);
  try {
    const outcome = retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: flat.file, failed: false });
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /no sections/);
  } finally {
    flat.clean();
  }
});

test('a failed card needs the reflection section, a passing one does not', () => {
  const passing = withDoc(`# JUL-310\n\n${LONG}\n## Findings\n\n${LONG}`);
  try {
    assert.equal(retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: passing.file, failed: false }).ok, true);
  } finally {
    passing.clean();
  }

  const failedWithout = withDoc(`# JUL-310\n\n${LONG}\n## Findings\n\n${LONG}`);
  try {
    const outcome = retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: failedWithout.file, failed: true });
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason, /Reflection: why the card failed/);
  } finally {
    failedWithout.clean();
  }

  const failedWith = withDoc(`# JUL-310\n\n${LONG}\n## Findings\n\n${LONG}\n## Reflection: why the card failed\n\n${LONG}`);
  try {
    assert.equal(retroOutcome({ text: 'RETRO: written docs/retros/jul-310.md', isError: false, file: failedWith.file, failed: true }).ok, true);
  } finally {
    failedWith.clean();
  }
});

test('an agent that errored or blocked says so instead of leaving an empty doc behind', () => {
  const dir = withDoc();
  try {
    const errored = retroOutcome({ text: 'The model service rejected the request.', isError: true, file: dir.file, failed: false });
    assert.equal(errored.ok, false);
    assert.match(errored.reason, /the retro agent failed/);

    const blocked = retroOutcome({ text: 'I could not read the checkout.\nRETRO: blocked the main worktree was missing', isError: false, file: dir.file, failed: false });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'the main worktree was missing');
  } finally {
    dir.clean();
  }
});

test('the task hands the agent the card, the commit, every determination and the rules', () => {
  const task = retroTask({
    card: 'JUL-310',
    pr: 420,
    title: 'Merge and cleanup',
    mergeCommit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    checkout: '/tmp/main',
    retroPath: 'docs/retros/jul-310.md',
    determinations: [
      { verdict: 'FAIL', sha: 'b'.repeat(40), body: 'CRITERION 2: not met' },
      { verdict: 'PASS', sha: 'a'.repeat(40), body: 'CRITERION 1: met' },
    ],
    changed: ['machine/merge/run.mjs'],
    failed: true,
    metrics: '1d 2h, 2 rounds',
  });
  assert.match(task, /docs\/retros\/jul-310\.md/);
  assert.match(task, /squash of pull request #420/);
  assert.match(task, /CRITERION 2: not met/);
  assert.match(task, /CRITERION 1: met/);
  assert.match(task, /## Reflection: why the card failed/);
  assert.match(task, /machine\/merge\/run\.mjs/);
  assert.match(task, /RETRO: written <path>/);
  assert.match(task, /Do not commit, do not push/);
});

test('a passing card is asked for a closing paragraph, not a reflection', () => {
  const task = retroTask({ card: 'JUL-310', pr: 420, title: 'Merge and cleanup', mergeCommit: 'abc1234', checkout: '/tmp/main', retroPath: 'docs/retros/jul-310.md' });
  assert.doesNotMatch(task, /Reflection: why the card failed/);
  assert.match(task, /keep doing/);
  assert.match(task, /No determination was recorded/);
});

test('the changed files come from the diff the machine already has', () => {
  const files = listChangedFiles({
    git: args => {
      assert.deepEqual(args, ['diff', '--name-only', 'aaa..bbb']);
      return 'machine/merge/run.mjs\n\nmachine/merge/gate.mjs\n';
    },
    from: 'aaa',
    to: 'bbb',
  });
  assert.deepEqual(files, ['machine/merge/run.mjs', 'machine/merge/gate.mjs']);
});
