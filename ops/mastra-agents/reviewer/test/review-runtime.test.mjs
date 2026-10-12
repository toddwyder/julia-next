import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewerRuntime } from '../src/reviewer.mjs';

test('the offline runtime wires stock bounds, authorization, durable budget, and provider journal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await createReviewerRuntime({
    runDirectory: directory,
    input: { files: ['a.mjs'], criteria: ['criterion'] },
    spending: { mode: 'paid', maxUsd: 0.50 },
    startedAt: 1_000_000,
    now: () => 1_000_000,
  });
  assert.deepEqual(runtime.generationOptions, {
    maxSteps: 40,
    modelSettings: { maxOutputTokens: 4096, timeout: { totalMs: 1_200_000, stepMs: 120_000 } },
  });

  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'runtime-1', choices: [{ message: { content: 'reply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await runtime.fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: JSON.stringify({ messages: [] }) });

  const budget = JSON.parse(await readFile(join(directory, 'review-budget.json'), 'utf8'));
  assert.deepEqual(budget.responses, ['runtime-1']);
  assert.equal(budget.pending, null);
  const events = JSON.parse(await readFile(join(directory, 'model-events.json'), 'utf8'));
  assert.deepEqual(events.map(event => event.kind), ['request', 'response', 'usage']);
});

test('the runtime refuses an authorization other than the approved per-review amount', async () => {
  await assert.rejects(
    createReviewerRuntime({ runDirectory: 'unused', input: { files: ['a'], criteria: ['c'] }, spending: { mode: 'paid', maxUsd: 1 } }),
    /approved \$0\.50 paid limit/,
  );
});
