import assert from 'node:assert/strict';
import test from 'node:test';
import { costOnlySpan, costNoteSpanRoute, costNoteSpanBatchRoute } from './src/mastra/cost-note-span-route.ts';

test('cost note span projection excludes prompts and unrelated attributes', () => {
  const span = costOnlySpan({ traceId: 't', spanId: 's', spanType: 'model_inference',
    startedAt: '2026-10-01T12:00:00Z', input: 'private prompt', output: 'private answer',
    requestContext: { secret: 'private' }, error: { message: 'private error' },
    metadata: { threadId: 'thread', prompt: 'private metadata' },
    attributes: { model: 'deepseek-v4-pro', usage: { inputTokens: 10, outputTokens: 2, prompt: 'private usage' },
      costContext: { provider: 'deepseek', prompt: 'private context' }, privateAttribute: 'private' } });
  assert.equal(span.traceId, 't');
  assert.equal(span.metadata.threadId, 'thread');
  assert.deepEqual(span.attributes.usage, { inputTokens: 10, outputTokens: 2 });
  assert.deepEqual(span.attributes.costContext, { provider: 'deepseek' });
  assert.equal(span.error.message, 'model call failed; details retained on server');
  assert.equal(JSON.stringify(span).includes('private'), false);
});

test('authenticated cost route projects storage response before it leaves the server', async () => {
  assert.equal(costNoteSpanRoute.requiresAuth, true);
  const handler = await costNoteSpanRoute.createHandler({ mastra: { getStorage: () => ({
    getStore: async () => ({ getSpan: async () => ({ span: { traceId: 't', spanId: 's',
      input: 'private prompt', attributes: { model: 'deepseek-v4-pro', usage: { inputTokens: 4, outputTokens: 2 } } } }) }),
  }) } });
  const response = await handler({ req: { param: key => ({ traceId: 't', spanId: 's' })[key] },
    json: (body, status = 200) => ({ body, status }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.span.attributes.model, 'deepseek-v4-pro');
  assert.equal(JSON.stringify(response.body).includes('private'), false);
});

test('cost projection preserves a model from a safe llm name and reasoning effort', () => {
  const span = costOnlySpan({ spanId: 's', name: 'llm: deepseek/deepseek-v4-pro',
    attributes: { parameters: { reasoning: { effort: 'high', prompt: 'private' } } } });
  assert.equal(span.attributes.model, 'deepseek/deepseek-v4-pro');
  assert.equal(span.attributes.effort, 'high');
  assert.equal(JSON.stringify(span).includes('private'), false);
});

test('cost route reports missing storage and spans without returning data', async () => {
  const context = { req: { param: key => ({ traceId: 't', spanId: 's' })[key] },
    json: (body, status = 200) => ({ body, status }) };
  const noStore = await costNoteSpanRoute.createHandler({ mastra: { getStorage: () => undefined } });
  assert.equal((await noStore(context)).status, 503);
  const noSpan = await costNoteSpanRoute.createHandler({ mastra: { getStorage: () => ({
    getStore: async () => ({ getSpan: async () => null }),
  }) } });
  assert.equal((await noSpan(context)).status, 404);
});

test('cost route logs failed storage reads without leaking storage error text', async () => {
  const context = { req: { param: key => ({ traceId: 'trace-t', spanId: 'span-s' })[key] },
    json: (body, status = 200) => ({ body, status }) };
  const handler = await costNoteSpanRoute.createHandler({ mastra: { getStorage: () => ({
    getStore: async () => ({ getSpan: async () => { throw new Error('private prompt'); } }),
  }) } });
  const original = console.error;
  const logs = [];
  console.error = (...parts) => logs.push(parts.join(' '));
  try {
    const response = await handler(context);
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(response).includes('private prompt'), false);
    assert.match(logs.join(' '), /cost span read.*trace-t.*Error/);
    assert.equal(logs.join(' ').includes('private prompt'), false);
  } finally {
    console.error = original;
  }
});

test('batch cost route returns ordered projections and bounds reads', async () => {
  const calls = [];
  const handler = await costNoteSpanBatchRoute.createHandler({ mastra: { getStorage: () => ({
    getStore: async () => ({ getSpan: async ({ spanId }) => { calls.push(spanId); return { span: {
      traceId: 't', spanId, attributes: { model: 'deepseek-v4-flash' }, input: 'private prompt',
    } }; } }),
  }) } });
  const context = ids => ({ req: { param: () => 't', query: () => ids }, json: (body, status = 200) => ({ body, status }) });
  const response = await handler(context('one,two'));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['one', 'two']);
  assert.deepEqual(response.body.spans.map(span => span.spanId), calls);
  assert.equal(JSON.stringify(response.body).includes('private'), false);
  assert.equal((await handler(context(Array(21).fill('id').join(',')))).status, 400);
  assert.equal(calls.length, 2);
});
