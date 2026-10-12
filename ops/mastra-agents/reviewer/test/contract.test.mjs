import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEWER, requireCompleteFileReview, reviewGenerationOptions, reviewPromptContract, reviewStepBudget, reviewerConfiguration } from '../src/contract.mjs';
import { captureCommandCodeResponse, commandCodeMetadata, reviewedFilesSchema } from '../src/reviewer.mjs';
import { commandCodeCostEstimate } from '../src/commandcode-cost.mjs';

test('the reviewer uses the approved stock generation bounds', () => {
  assert.deepEqual(DEFAULT_REVIEWER.model, 'deepseek/deepseek-v4.1-flash');
  assert.deepEqual(reviewGenerationOptions(['a.mjs'], ['criterion']), {
    maxSteps: 40,
    modelSettings: {
      maxRetries: 0,
      maxOutputTokens: 4096,
      timeout: { totalMs: 1_200_000, stepMs: 120_000 },
    },
  });
});

test('reviewer step budget follows the immutable file inventory and contract phases', () => {
  assert.equal(reviewStepBudget(['a.mjs'], ['criterion']), 40);
  assert.equal(reviewStepBudget(['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'], Array(8).fill('criterion')), 70);
  assert.throws(() => reviewStepBudget([], ['criterion']), /changed file/);
  assert.throws(() => reviewStepBudget(['a.mjs'], []), /criterion/);
});

test('structured output accepts exactly the immutable changed-file inventory', () => {
  const schema = reviewedFilesSchema(['a.mjs', 'b.mjs']);
  assert.deepEqual(schema.parse(['a.mjs', 'b.mjs']), ['a.mjs', 'b.mjs']);
  assert.throws(() => schema.parse(['a.mjs', 'extra.mjs']));
  assert.throws(() => schema.parse(['a.mjs']));
});

test('the model prompt keeps requirements and proof but reads candidate bytes through tools', () => {
  const input = { candidate: 'abc', sources: { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof', diff: 'large diff', 'file:a.mjs': 'large file' } };
  assert.deepEqual(reviewPromptContract(input), {
    candidate: 'abc', sources: { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof' },
    recording: {
      mode: 'small-tools',
      record: 'record_piece', replace: 'replace_piece', remove: 'remove_piece', missing: 'show_missing', submit: 'submit_report',
    },
  });
  assert.deepEqual(input.sources, { specification: 'requirements', clarifications: 'decisions', 'test-evidence': 'proof', diff: 'large diff', 'file:a.mjs': 'large file' });
});

test('per-card reviewer model overrides the CommandCode default', () => {
  assert.equal(reviewerConfiguration({ reviewer: { model: 'deepseek/custom' } }).model, 'deepseek/custom');
  assert.equal(reviewerConfiguration({ reviewer: { connection: { route: 'api', provider: 'commandcode' } } }).connection, 'existing-commandcode');
  assert.equal(reviewerConfiguration().model, DEFAULT_REVIEWER.model);
});

test('published CommandCode prices produce a labeled estimate from every token category', async () => {
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 400_000 } };
  assert.deepEqual(commandCodeCostEstimate(usage, new Date('2026-10-11T18:00:00Z')), {
    cost: 0.6912, kind: 'estimated', source: 'commandcode.pricing.2026-10-11', priceBand: 'off-peak',
  });
  assert.deepEqual(commandCodeCostEstimate(usage, new Date('2026-10-12T06:30:00Z')), {
    cost: 1.3812, kind: 'estimated', source: 'commandcode.pricing.2026-10-11', priceBand: 'peak',
  });
  assert.throws(() => commandCodeCostEstimate({ completion_tokens: 4 }), /prompt_tokens is missing or unknown/);
  assert.throws(() => commandCodeCostEstimate({ prompt_tokens: 8 }), /completion_tokens is missing or unknown/);
});

test('raw CommandCode tokens survive schema normalization and carry the published-price estimate', async () => {
  const usage = { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 };
  captureCommandCodeResponse({ id: 'raw-response-a', usage });
  const metadata = await commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-a', usage } });
  assert.equal(metadata.commandcode.responseId, 'raw-response-a');
  assert.deepEqual(metadata.commandcode.usage, usage);
  assert.equal(metadata.commandcode.cost.source, 'commandcode.pricing.2026-10-11');
  assert.equal(metadata.commandcode.cost.kind, 'estimated');
  assert.ok(metadata.commandcode.cost.cost > 0);
  await assert.rejects(commandCodeMetadata.extractMetadata({ parsedBody: { id: 'raw-response-b', usage } }), /response identity is missing or unknown/);
});

test('a verdict fails closed unless it accounts for every changed file exactly once', () => {
  assert.doesNotThrow(() => requireCompleteFileReview(['a.mjs', 'nested/b.mjs'], ['nested/b.mjs', 'a.mjs']));
  assert.throws(() => requireCompleteFileReview(['a.mjs', 'nested/b.mjs'], ['a.mjs']), /missing nested\/b\.mjs/);
  assert.throws(() => requireCompleteFileReview(['a.mjs'], ['a.mjs', 'invented.mjs']), /unexpected invented\.mjs/);
  assert.throws(() => requireCompleteFileReview(['a.mjs'], ['a.mjs', 'a.mjs']), /duplicate a\.mjs/);
});
