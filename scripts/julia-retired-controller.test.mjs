import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const retiredPaths = [
  '../graph/controller',
  './controller-stand-in.mjs',
  './run-seat.mjs',
  './run-seat.test.mjs',
  './stand-in-seat.mjs',
  './stand-in-seat.test.mjs',
];

test('the retired graph controller and its worker harness are not executable source', () => {
  for (const path of retiredPaths) assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
});

test('the active suite has no historical-controller exclusion lane', () => {
  const suite = readFileSync(new URL('./julia-runner-suite.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(suite, /HISTORICAL_TESTS|controller-(?:board|carry)\.test|stand-in-seat\.test/);
});
