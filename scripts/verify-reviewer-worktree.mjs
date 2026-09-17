#!/usr/bin/env node
// verify-reviewer-worktree.mjs -- JUL-61 step 5: a reviewer reads the
// candidate commit and writes its report elsewhere; it must never change the
// candidate itself. This diffs the reviewer's worktree against the exact
// commit it was handed. Any difference (uncommitted edit, staged change, or
// a new commit) rejects the review outright -- the coordinator must not
// trust a review from a worktree that no longer matches the candidate.
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export async function verifyReviewerWorktreeUnchanged({ worktreePath, candidateCommit, execFileImpl = execFile }) {
  if (!worktreePath) throw new Error('worktreePath is required');
  if (!/^[0-9a-f]{7,40}$/i.test(candidateCommit ?? '')) {
    throw new Error(`candidateCommit must be a commit SHA (or unambiguous prefix), got ${JSON.stringify(candidateCommit)}`);
  }

  // `git diff <commit>` compares the working tree (staged and unstaged) to
  // that commit, so it catches an uncommitted edit and a committed one alike
  // -- a reviewer that commits its tampering doesn't escape this check.
  const { stdout } = await execFileImpl('git', ['-C', worktreePath, 'diff', '--stat', candidateCommit], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const diff = stdout.trim();
  return { clean: diff.length === 0, diff };
}

export async function rejectIfReviewerTampered(args) {
  const { clean, diff } = await verifyReviewerWorktreeUnchanged(args);
  if (!clean) {
    throw new Error(`review rejected: reviewer worktree diverges from candidate commit ${args.candidateCommit}\n${diff}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const { worktree, commit } = parseArgs(process.argv.slice(2));
  if (!worktree || !commit) {
    console.error('usage: node verify-reviewer-worktree.mjs --worktree <path> --commit <sha>');
    process.exitCode = 2;
    return;
  }
  try {
    await rejectIfReviewerTampered({ worktreePath: worktree, candidateCommit: commit });
    console.log(JSON.stringify({ clean: true }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
