import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteIsPresent } from '../src/quote-check.mjs';

test('quote check accepts an exact quote only', () => {
  assert.equal(quoteIsPresent('exitCode=1', 'artifact: test-exit.txt\nexitCode=1\n'), true);
  assert.equal(quoteIsPresent('exitcode=1', 'artifact: test-exit.txt\nexitCode=1\n'), false);
});
