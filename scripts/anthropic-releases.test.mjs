import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlatformReleaseNotes } from './anthropic-releases.mjs';

test('parsePlatformReleaseNotes extracts dated Anthropic model and API release sections', () => {
  const sample = [
    '# Claude Platform release notes',
    '',
    '### November 17, 2026',
    '* Launched Linked billing in beta.',
    '',
    '### November 9, 2026',
    '* Launched **Claude Fable 5.2** (`claude-fable-5-2`) with 1M context window.',
  ].join('\n');

  const parsed = parsePlatformReleaseNotes(sample, { limit: 5 });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 'platform:2026-11-17');
  assert.equal(parsed[0].publishedAt, '2026-11-17T00:00:00Z');
  assert.match(parsed[0].notes, /Linked billing/);
  assert.equal(parsed[1].id, 'platform:2026-11-09');
  assert.match(parsed[1].notes, /Claude Fable 5\.2/);
});
