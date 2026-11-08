import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareDependencies } from './run-parts.mjs';

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
