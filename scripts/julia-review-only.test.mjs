import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedReviewConfiguration, parseReviewOnlyCommand } from './julia-review-only.mjs';

test('startReviewOnly accepts only a card and an existing pull request', () => {
  assert.deepEqual(parseReviewOnlyCommand(['JUL-206', '--pr', '282']), { issueId: 'JUL-206', pullRequest: 282 });
  assert.throws(() => parseReviewOnlyCommand(['JUL-206']), /use JUL-nnn --pr positive-number/);
  assert.throws(() => parseReviewOnlyCommand(['JUL-206', '--pr', '0']), /use JUL-nnn --pr positive-number/);
});

test('review-only configuration keeps the authorized per-card cap out of prompts', () => {
  const configuration = authorizedReviewConfiguration();
  assert.equal(configuration.reviewer.model, 'deepseek/deepseek-v4.1-flash');
  assert.equal(configuration.reviewer.connection.provider, 'commandcode');
  assert.equal(configuration.reviewer.connection.protocol, 'openai-completions');
  assert.equal(configuration.reviewer.connection.authReference, 'env:COMMANDCODE_API_KEY');
  assert.equal('maxOutputTokens' in configuration.reviewer, false);
});
