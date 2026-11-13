// The cost record: each model call counted once, the run total, each stage's
// share, and an unknown price left unknown rather than guessed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createMockModel } = await import('@mastra/core/test-utils/llm-mock');
const { costRecord, summarise } = await import('./trace.mjs');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');

const CARD = 'JUL-336-STANDIN';

const row = (fields) => ({
  eventType: 'end',
  attributes: null,
  runId: 'run-1',
  traceId: 'trace-1',
  parentSpanId: null,
  ...fields,
});

const inference = (spanId, parentSpanId, usage) =>
  row({
    spanType: 'model_inference',
    name: 'inference: 0',
    spanId,
    parentSpanId,
    attributes: JSON.stringify({ usage }),
  });

const stepSpan = (spanId, name) =>
  row({ spanType: 'workflow_step', name: `workflow step: '${name}'`, spanId, parentSpanId: 'wf' });

test('every model call is counted once, even when its start row arrives twice', () => {
  const spans = [
    stepSpan('step-shipping', 'shipping'),
    stepSpan('step-build', 'build'),
    // A duplicated start row and its end row for the same call.
    row({ eventType: 'start', spanType: 'model_inference', name: 'inference: 0', spanId: 'call-1', parentSpanId: 'step-shipping' }),
    row({ eventType: 'start', spanType: 'model_inference', name: 'inference: 0', spanId: 'call-1', parentSpanId: 'step-shipping', attributes: '{}' }),
    inference('call-1', 'step-shipping', { inputTokens: 100, outputTokens: 20 }),
    inference('call-2', 'step-build', { inputTokens: 40, outputTokens: 8 }),
    inference('call-3', 'step-build', { inputTokens: 10, outputTokens: 2 }),
  ];

  const record = summarise(spans);

  assert.equal(record.modelCalls, 3);
  assert.equal(record.total.inputTokens, 150);
  assert.equal(record.total.outputTokens, 30);
  assert.deepEqual(
    record.perStage.map(({ stage, modelCalls, inputTokens, outputTokens, share }) => ({
      stage,
      modelCalls,
      inputTokens,
      outputTokens,
      share,
    })),
    [
      { stage: 'build', modelCalls: 2, inputTokens: 50, outputTokens: 10, share: 0.667 },
      { stage: 'shipping', modelCalls: 1, inputTokens: 100, outputTokens: 20, share: 0.333 },
    ],
  );
});

const catalog = {
  source: 'test-list',
  costs: { commandcode: { models: {
    'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
  } } },
};
const corrections = { peakWindows: [{
  provider: 'commandcode',
  modelPrefix: 'deepseek/',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  from: '01:00',
  to: '04:00',
  timezone: 'UTC',
  multiplier: 2,
}], freeModels: [], excludeDates: [] };
const metric = (fields) => ({ spanId: 'call-1', name: '', value: 0, timestamp: '2026-11-13T02:00:00Z', ...fields });

test('a model with no published price is reported as unknown, with the reason', () => {
  const record = summarise([stepSpan('step-build', 'build'), inference('call-1', 'step-build', { inputTokens: 5, outputTokens: 1 })], [
    metric({ provider: 'commandcode', model: 'nobody/no-such-model', name: 'mastra_model_input_text_tokens', value: 5 }),
  ], { catalog, corrections });

  assert.equal(record.usd, null);
  assert.match(record.costNote, /nobody\/no-such-model/);
});

test('a peak-hour DeepSeek call is priced at the peak rate, not the installed table rate', () => {
  const record = summarise([stepSpan('step-build', 'build'), inference('call-1', 'step-build', { inputTokens: 1000000, outputTokens: 0 })], [
    metric({ provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', name: 'mastra_model_input_text_tokens', value: 1000000 }),
  ], { catalog, corrections });

  assert.equal(record.usd, 0.3);
  assert.match(record.costNote, /same list the model picker uses/);
});

test('a trace with no model calls says so instead of inventing a price', () => {
  const record = summarise([stepSpan('step-build', 'build')]);

  assert.equal(record.modelCalls, 0);
  assert.equal(record.usd, null);
  assert.match(record.costNote, /no priced metric/);
});

test('the run record on disk answers the same way for a real trace file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-cost-'));
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  openScratch(dir);
  mkdirSync(join(dir, CARD), { recursive: true });
  writeFileSync(join(dir, CARD, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(dir, CARD, 'cursors.json'), '{}');

  const repo = join(dir, 'studio');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=flow@test', '-c', 'user.name=flow', 'commit', '--quiet', '-m', 'main'], { cwd: repo });

  // The Codex route answers only a streamed request, so a stage agent that is asked to generate fails the way
  // it does there: HTTP 400 "Stream must be set to true".
  const stub = text => ({
    generate: async () => { throw new Error('Bad Request: Stream must be set to true'); },
    stream: async () => ({ text: Promise.resolve(text) }),
  });
  const workflow = buildCardPath({
    agents: {
      build: new Agent({
        id: 'flow-build',
        name: 'Flow build',
        instructions: 'Reply with one line.',
        model: createMockModel({ mockText: 'built line' }),
      }),
      shipping: { stream: async () => ({ text: Promise.resolve('VERDICT: PASS\nCRITERION 1: PASS — ok\nNOTES: none') }) },
      remediation: stub('c'),
      retro: stub('d'),
    },
    dir,
    repo,
    review: {
      findPr: () => ({ pr: 1 }),
      readCard: async identifier => ({ identifier, title: 't', description: '## Acceptance criteria\n- ok' }),
      moveCard: async () => {},
      headCommit: () => 'abc',
      postPrComment: () => {},
    },
  });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  await run.start({ inputData: { card: CARD, kind: 'machine' } });
  await mastra.shutdown();

  const record = await costRecord(join(dir, 'trace.duckdb'));

  assert.equal(record.modelCalls, 1, 'the build agent step made one model call');
  assert.deepEqual(
    record.perStage.map(row => row.stage),
    ['flow-build'],
    'the call is counted under the build step that made it',
  );
  assert.equal(record.usd, null, 'the free mock model has no published price');
  assert.equal(typeof record.costNote, 'string');
  rmSync(dir, { recursive: true, force: true });
});
