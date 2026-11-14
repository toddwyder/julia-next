import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { closeCopy, copyFolder, copiesRoot, openCopy, startedFrom } from './copy.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function studio(t) {
  const dir = mkdtempSync(join(tmpdir(), 'copy-case-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'studio');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=copy@test', '-c', 'user.name=copy', 'commit', '--quiet', '-m', 'main']);
  return { dir, repo, env: { FLOW_SCRATCH: join(dir, 'scratch') } };
}

test('a card’s copy goes when the card ends and its branch stays for the pull request', t => {
  const { repo, env } = studio(t);
  const copy = openCopy({ repo, card: 'JUL-402', env });
  writeFileSync(join(copy.folder, 'pushed.txt'), 'the build’s work\n');

  assert.equal(closeCopy({ repo, card: 'JUL-402', env }), true);
  assert.equal(existsSync(copy.folder), false);
  assert.equal(git(repo, ['for-each-ref', 'refs/card-base']).includes('JUL-402'), false, 'the base ref goes too');
  assert.equal(git(repo, ['branch', '--list', 'card/JUL-402']).includes('card/JUL-402'), true);
  assert.equal(git(repo, ['worktree', 'list']).includes('JUL-402'), false, 'Git no longer knows the folder');
  assert.equal(closeCopy({ repo, card: 'JUL-402', env }), false, 'closing twice is quiet');
});

test('a card name that is not a plain word still gets a usable folder and branch', t => {
  const { repo, env } = studio(t);
  const copy = openCopy({ repo, card: 'JUL 403/a', env });

  assert.equal(copyFolder('JUL 403/a', env), join(copiesRoot(env), 'JUL-403-a'));
  assert.equal(existsSync(copy.folder), true);
  assert.equal(git(repo, ['branch', '--list', 'card/JUL-403-a']).includes('card/JUL-403-a'), true);
});

test('a repository with no main branch says so instead of making an empty copy', t => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet', '--initial-branch=main']);

  assert.throws(() => startedFrom(dir), /has no main branch/);
});
