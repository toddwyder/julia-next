import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuotes, evidenceCitations, quoteIsPresent } from '../src/quote-check.mjs';

test('quote check accepts an exact quote only', () => {
  assert.equal(quoteIsPresent('exitCode=1', 'artifact: test-exit.txt\nexitCode=1\n'), true);
  assert.equal(quoteIsPresent('exitcode=1', 'artifact: test-exit.txt\nexitCode=1\n'), false);
});

test('quote check discovers every nested initial or repair citation', () => {
  const report = {
    standards: { evidence: [{ source: 'diff', quote: 'changed code' }] },
    repairedFindings: [{ evidence: [{ source: 'prior-review', quote: 'old finding' }, { source: 'repair-file:a.mjs', quote: 'fixed code' }] }],
  };
  assert.deepEqual(evidenceCitations(report), [
    { source: 'diff', quote: 'changed code' },
    { source: 'prior-review', quote: 'old finding' },
    { source: 'repair-file:a.mjs', quote: 'fixed code' },
  ]);
});

test('quote check prefers the authoritative cumulative diff and deleted-file sources', async () => {
  const report = { evidence: [
    { source: 'diff', quote: 'change from an earlier candidate commit' },
    { source: 'file:deleted.mjs', quote: 'content retained from the base revision' },
  ] };
  const checks = await checkQuotes('missing-repository', 'f'.repeat(40), report, {
    diff: 'change from an earlier candidate commit',
    'file:deleted.mjs': 'content retained from the base revision',
  });
  assert.deepEqual(checks.map(check => check.ok), [true, true]);
});
