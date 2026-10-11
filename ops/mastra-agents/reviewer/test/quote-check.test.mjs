import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuotes, evidenceCitations, quoteIsPresent, repairSerializedEvidenceQuotes, verifyEvidenceQuote } from '../src/quote-check.mjs';

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

test('the model-facing quote verifier accepts only exact immutable candidate text', async () => {
  assert.deepEqual(await verifyEvidenceQuote('missing-repository', 'f'.repeat(40), 'diff', 'exact candidate text', {
    diff: 'before\nexact candidate text\nafter',
  }), { ok: true });
  assert.deepEqual(await verifyEvidenceQuote('missing-repository', 'f'.repeat(40), 'diff', 'Exact candidate text', {
    diff: 'before\nexact candidate text\nafter',
  }), { ok: false });
});

test('serialized source control characters are repaired only to exact source text', () => {
  const report = { evidence: [{ source: 'candidate', quote: 'checks\tpass\nurl' }, { source: 'diff', quote: 'unchanged\ttext' }] };
  assert.deepEqual(repairSerializedEvidenceQuotes(report, {
    candidate: 'prefix checks\\tpass\\nurl suffix', diff: 'unchanged\ttext',
  }), [{ source: 'candidate', before: 'checks\tpass\nurl', after: 'checks\\tpass\\nurl' }]);
  assert.equal(report.evidence[0].quote, 'checks\\tpass\\nurl');
  assert.equal(report.evidence[1].quote, 'unchanged\ttext');
});
