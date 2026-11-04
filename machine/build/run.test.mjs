// The card's entry point: arguments, where the run keeps its record and its
// trace, and what a dry run prints. No model, no network.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseArgs, runDirFor, startCard, traceFileForCard } from './run.mjs';

test('the card is the first argument, and the number after a flag is its value', () => {
  const options = parseArgs(['JUL-334', '--pr', '42', '--time-limit-min', '30']);

  assert.equal(options.card, 'JUL-334');
  assert.equal(options.pr, 42);
  assert.equal(options.timeLimitMs, 30 * 60_000);
  assert.equal(options.dryRun, false);
});

test('a card identifier in lower case is still the card', () => {
  assert.equal(parseArgs(['jul-9']).card, 'JUL-9');
});

test('an argument the entry point does not know is refused', () => {
  assert.throws(() => parseArgs(['JUL-334', '--turbo']), /unknown argument --turbo/);
  assert.throws(() => parseArgs(['JUL-334', '--pr', 'soon']), /pull request number/);
  assert.throws(() => parseArgs(['JUL-334', '--time-limit-min', '0']), /minutes/);
});

test('the run keeps its record under the card, and its trace beside the other stages', () => {
  assert.equal(runDirFor('JUL-334', '/repo'), path.join('/repo', '.artifacts', 'build', 'JUL-334'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-traces-'));
  const trace = traceFileForCard('JUL-334', dir);

  assert.equal(path.dirname(trace), dir);
  assert.match(path.basename(trace), /^\d{4}-\d{2}-\d{2}T[\d-]+Z-\d+-build-JUL-334\.duckdb$/);
});

test('a dry run says what each step would do and starts nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-dry-'));
  const lines = [];

  const result = await startCard(
    { card: 'JUL-334', pr: 42, model: null, timeLimitMs: 60 * 60_000, dryRun: true },
    { root: dir, log: line => lines.push(line) },
  );

  assert.equal(result.code, 0);
  assert.match(lines[0], /build: in-process agent for JUL-334 on the feature model in ~\/\.agents\/pstack-models\.md, 60 minute limit/);
  assert.match(lines[1], /^review: node scripts\/julia-agents\.mjs -- node machine\/remediation\/run\.mjs --pr 42 --card JUL-334$/);
  assert.match(lines[2], /^landing: node scripts\/julia-agents\.mjs -- node machine\/merge\/run\.mjs --pr 42 --card JUL-334$/);
  assert.equal(fs.existsSync(path.join(dir, '.artifacts')), false);
});
