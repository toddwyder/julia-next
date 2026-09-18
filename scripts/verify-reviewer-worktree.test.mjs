import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { verifyReviewerWorktreeUnchanged, rejectIfReviewerTampered } from './verify-reviewer-worktree.mjs';

const execFile = promisify(execFileCb);

async function makeCandidateRepoAndWorktree() {
  const root = await mkdtemp(path.join(tmpdir(), 'jul61-reviewer-'));
  const repo = path.join(root, 'candidate');
  const worktree = path.join(root, 'reviewer-worktree');

  await execFile('git', ['init', '-q', repo]);
  await execFile('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  await execFile('git', ['-C', repo, 'config', 'user.name', 'Test']);
  await writeFile(path.join(repo, 'file.txt'), 'original\n');
  await execFile('git', ['-C', repo, 'add', 'file.txt']);
  await execFile('git', ['-C', repo, 'commit', '-q', '-m', 'candidate commit']);
  const { stdout } = await execFile('git', ['-C', repo, 'rev-parse', 'HEAD']);
  const candidateCommit = stdout.trim();

  // A real `git worktree add` for a detached checkout at the candidate commit.
  await execFile('git', ['-C', repo, 'worktree', 'add', '--detach', worktree, candidateCommit]);

  return { root, repo, worktree, candidateCommit };
}

test('a clean reviewer worktree (no changes since the candidate commit) passes', async () => {
  const { root, worktree, candidateCommit } = await makeCandidateRepoAndWorktree();
  try {
    const result = await verifyReviewerWorktreeUnchanged({ worktreePath: worktree, candidateCommit });
    assert.equal(result.clean, true);
    assert.equal(result.diff, '');
    await assert.doesNotReject(() => rejectIfReviewerTampered({ worktreePath: worktree, candidateCommit }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a reviewer that edits a file (uncommitted) has its review rejected (JUL-61 step 5)', async () => {
  const { root, worktree, candidateCommit } = await makeCandidateRepoAndWorktree();
  try {
    await appendFile(path.join(worktree, 'file.txt'), 'reviewer tampering\n');

    const result = await verifyReviewerWorktreeUnchanged({ worktreePath: worktree, candidateCommit });
    assert.equal(result.clean, false);
    assert.match(result.diff, /file\.txt/);

    await assert.rejects(
      () => rejectIfReviewerTampered({ worktreePath: worktree, candidateCommit }),
      /review rejected: reviewer worktree diverges from candidate commit/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a reviewer that commits its own edit is caught too, not just uncommitted diffs', async () => {
  const { root, worktree, candidateCommit } = await makeCandidateRepoAndWorktree();
  try {
    await execFile('git', ['-C', worktree, 'config', 'user.email', 'reviewer@example.com']);
    await execFile('git', ['-C', worktree, 'config', 'user.name', 'Reviewer']);
    await appendFile(path.join(worktree, 'file.txt'), 'committed tampering\n');
    await execFile('git', ['-C', worktree, 'commit', '-q', '-am', 'reviewer edit']);

    const result = await verifyReviewerWorktreeUnchanged({ worktreePath: worktree, candidateCommit });
    assert.equal(result.clean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a candidateCommit that is not a plausible SHA', async () => {
  await assert.rejects(
    () => verifyReviewerWorktreeUnchanged({ worktreePath: '.', candidateCommit: 'main' }),
    /candidateCommit must be a commit SHA/,
  );
});

test('scopes safe.directory to exactly the passed worktreePath (JUL-73: orchestrator-svc verifying a runner-owned reviewer worktree hits git\'s dubious-ownership guard otherwise, live-verified)', async () => {
  let calledArgs;
  const execFileImpl = async (cmd, args) => {
    calledArgs = args;
    return { stdout: '' };
  };
  await verifyReviewerWorktreeUnchanged({ worktreePath: '/home/runner/some-review-worktree', candidateCommit: 'abc1234', execFileImpl });
  const idx = calledArgs.indexOf('safe.directory=/home/runner/some-review-worktree');
  assert.ok(idx > 0, `expected a -c safe.directory=/home/runner/some-review-worktree flag in ${JSON.stringify(calledArgs)}`);
  assert.equal(calledArgs[idx - 1], '-c');
});
