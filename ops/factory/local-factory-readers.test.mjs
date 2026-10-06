import test from 'node:test';
import assert from 'node:assert/strict';

import { readLocalSessionMessages, readLocalTraceSpans } from './local-factory-readers.mjs';

test('the local readers reconstruct trace data and fallback-message content without HTTP', async () => {
  const spans = await readLocalTraceSpans({
    from: '2026-09-29T00:00:00Z', to: '2026-10-07T00:00:00Z',
    runQuery: async ({ parameters }) => {
      assert.deepEqual(parameters, ['2026-09-29T00:00:00Z', '2026-10-07T00:00:00Z']);
      return [{ traceId: 'trace-1', spanId: 'span-1', sessionId: 'session-1', name: 'build', spanType: 'model_generation', startedAt: '2026-09-30T00:00:00Z', endedAt: '2026-09-30T00:00:01Z', attributes: '{"costContext":{"estimatedCost":0.12,"provider":"openai","model":"gpt"},"usage":{"inputTokens":10,"inputTokenDetails":{"cacheRead":2},"outputTokens":3,"outputTokenDetails":{"reasoning":1}}}', metadata: null, scope: null, error: null }];
    },
  });
  const messages = await readLocalSessionMessages({
    threadId: 'thread-1',
    runPsql: async () => ({ status: 0, stdout: '{"content":{"parts":[{"type":"data-mastracode-pack-fallback","data":{"reason":"pool-exhausted"}}]}}\n' }),
  });

  assert.equal(spans[0].attributes.costContext.estimatedCost, 0.12);
  assert.equal(spans[0].sessionId, 'session-1');
  assert.deepEqual(messages[0].content.parts[0].data, { reason: 'pool-exhausted' });
});
