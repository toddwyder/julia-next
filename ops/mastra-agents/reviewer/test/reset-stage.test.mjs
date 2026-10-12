import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewerInstructions, runReviewer, STANDING_RULES } from '../src/reviewer.mjs';

test('the six standing rules are part of the fixed reviewer instructions', () => {
  const instructions = reviewerInstructions('ADVERSARIAL ROLE', 'CODING STANDARDS');
  assert.match(instructions, /ADVERSARIAL ROLE/);
  assert.match(instructions, /CODING STANDARDS/);
  for (const rule of STANDING_RULES.split('\n').slice(1)) assert.ok(instructions.includes(rule), rule);
});

test('the stage-one reset refuses reviewer execution before any provider request', async () => {
  const originalKey = process.env.COMMANDCODE_API_KEY;
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  process.env.COMMANDCODE_API_KEY = 'offline-fixture-key';
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error('provider request must not be attempted during the reset');
  };

  try {
    await assert.rejects(
      runReviewer({
        issueId: 'JUL-223',
        runId: 'stage-one-reset',
        repoRoot: process.cwd(),
        candidate: { base: 'a'.repeat(40), commit: 'b'.repeat(40) },
        input: { candidate: 'b'.repeat(40), digest: 'fixture', files: ['fixture.mjs'], criteria: ['fixture'] },
        configuration: { connection: 'existing-commandcode' },
        verdictPath: 'unused-stage-one-verdict.json',
      }),
      /reviewer reset is incomplete; paid execution is disabled/i,
    );
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.COMMANDCODE_API_KEY;
    else process.env.COMMANDCODE_API_KEY = originalKey;
  }
});
