import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareCheckout, prepareDependencies } from './run-parts.mjs';

test('the root and dashboard trees are installed one at a time, with dev dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-install-'));
  const trees = [root, path.join(root, 'dashboard')];
  for (const tree of trees) {
    fs.mkdirSync(tree, { recursive: true });
    fs.writeFileSync(path.join(tree, 'package.json'), '{}');
    fs.writeFileSync(path.join(tree, 'package-lock.json'), '{}');
  }

  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'npm'),
    [
      '#!/bin/sh',
      `printf 'start %s %s\\n' "$PWD" "$*" >> ${JSON.stringify(calls)}`,
      'sleep 0.2',
      `printf 'end %s\\n' "$PWD" >> ${JSON.stringify(calls)}`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );

  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  try {
    prepareDependencies(root, { timeoutMs: 10_000 });
  } finally {
    process.env.PATH = previous;
  }

  const lines = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map(line => line.split(' ')[0]), ['start', 'end', 'start', 'end']);
  assert.match(lines[0], new RegExp(`^start ${root} ci --include=dev`));
  assert.match(lines[2], new RegExp(`^start ${path.join(root, 'dashboard')} ci --include=dev`));
  assert.equal(fs.readFileSync(calls, 'utf8').match(/^start /gm).length, 2);
});

test('a checkout whose lockfile matches main links the installed trees instead of installing', () => {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-main-'));
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-review-'));
  for (const relative of ['', 'dashboard']) {
    const mainTree = path.join(mainRoot, relative);
    const reviewTree = path.join(checkout, relative);
    fs.mkdirSync(path.join(mainTree, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(mainTree, 'node_modules', '.package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(mainTree, 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.mkdirSync(reviewTree, { recursive: true });
    fs.writeFileSync(path.join(reviewTree, 'package-lock.json'), '{"lockfileVersion":3}\n');
  }

  const bin = path.join(checkout, 'bin');
  const calls = path.join(checkout, 'calls.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });

  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  try {
    prepareDependencies(checkout, { mainRoot, timeoutMs: 5_000 });
  } finally {
    process.env.PATH = previous;
  }

  assert.equal(fs.existsSync(calls), false);
  for (const relative of ['', 'dashboard']) {
    const installed = path.join(checkout, relative, 'node_modules');
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(installed, '.package-lock.json')), true);
  }
});

// The 20:34 run died at checkout: a worktree directory left behind after its git
// registration was pruned made `git worktree add` refuse with "already exists".
test('a leftover checkout directory is cleared so the review can check out again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-checkout-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const identity = ['-c', 'user.email=a@b', '-c', 'user.name=a'];

  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  git(['init', '--quiet', '-b', 'main'], source);
  git([...identity, 'commit', '--allow-empty', '-m', 'first'], source);
  git([...identity, 'commit', '--allow-empty', '-m', 'reviewed'], source);
  const head = git(['rev-parse', 'HEAD'], source).trim();
  git(['update-ref', 'refs/pull/487/head', head], source);

  // The machine's repository, with that clone as its origin.
  const machine = path.join(root, 'machine');
  fs.mkdirSync(machine);
  git(['init', '--quiet', '-b', 'main'], machine);
  git(['remote', 'add', 'origin', source], machine);

  const checkout = path.join(root, 'worktree');
  const runDir = path.join(root, 'run');
  fs.mkdirSync(checkout, { recursive: true });
  fs.writeFileSync(path.join(checkout, 'left-behind.txt'), 'stale\n');

  const sha = prepareCheckout(487, runDir, checkout, { root: machine });

  assert.equal(sha, head, 'the review is checked out at the pull request head');
  assert.equal(fs.existsSync(path.join(checkout, 'left-behind.txt')), false, 'the leftover file is gone');
  assert.equal(fs.existsSync(path.join(checkout, '.git')), true, 'a real worktree replaced it');
});
