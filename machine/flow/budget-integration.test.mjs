import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Memory } from '@mastra/memory';
import { createTool } from '@mastra/core/tools';
import { buildCardPath } from './workflow.mjs';
import { openScratch } from './scratch.mjs';
import { createSliceControl } from '../budget/control.mjs';
import { createBuildBudget, MEMORY_MAX_OUTPUT_TOKENS } from './agents.mjs';
import { openMastra } from './mastra.mjs';

const scratch = join(homedir(), '.local/state/julia-scratch');
mkdirSync(scratch, { recursive: true });
const MODEL = 'openai/gpt-6.1-sol';

async function fixture(t, { dollarCap = 4, tokenCap = 2e6, id = MODEL, fail = false, memory = false, toolCall, fullWorkflow = false } = {}) {
  const dir = mkdtempSync(join(scratch, 'budget-integration-'));
  let stops = 0;
  const control = createSliceControl({ directory: join(dir, 'budget'), dollarCap, tokenCap });
  const budget = createBuildBudget({ control, repo: dir, onStop: () => { stops += 1; } });
  let calls = 0;
  const spy = () => { calls += 1; if (fail) throw new Error('planted provider failure'); };
  const mock = createMockModel({ mockText: 'hello', spyStream: spy, spyGenerate: spy });
  let toolExecutions = 0;
  if (toolCall) {
    mkdirSync(join(dir, 'graphify-out'));
    writeFileSync(join(dir, 'graphify-out/graph.json'), JSON.stringify({ nodes: [{ id: 'a', label: 'a', file: 'a.mjs' }], links: [] }));
    const baseGenerate = mock.doGenerate.bind(mock);
    mock.doGenerate = async options => {
      if (calls) return baseGenerate(options);
      spy();
      return { content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'mastra_workspace_execute_command', input: JSON.stringify({ command: toolCall }) }],
        finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10 }, warnings: [] };
    };
    const baseStream = mock.doStream.bind(mock);
    mock.doStream = async options => {
      if (calls) return baseStream(options);
      spy();
      return { stream: new ReadableStream({ start(stream) {
        stream.enqueue({ type: 'stream-start', warnings: [] });
        stream.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'mastra_workspace_execute_command', input: JSON.stringify({ command: toolCall }) });
        stream.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10 } });
        stream.close();
      } }) };
    };
  }
  let nativeMemory;
  if (memory) {
    const actor = role => control.wrapModel(createMockModel({ mockText: '<observations>Observed hello.</observations><current-task>Reply hello</current-task><suggested-response>Hello</suggested-response>' }),
      { id: memory.unpriced === role ? 'unpriced/memory' : 'openai/gpt-6-luna', role });
    nativeMemory = new Memory({ options: { observationalMemory: {
      observation: { model: actor('observer'), messageTokens: 1, bufferTokens: false, maxRetries: 0, modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
      reflection: { model: actor('reflector'), observationTokens: memory.reflect ? 1 : 1e5, maxRetries: 0, modelSettings: { maxOutputTokens: MEMORY_MAX_OUTPUT_TOKENS } },
    } } });
    budget.addMemory(nativeMemory);
  }
  const agent = new Agent({ id: 'budget-build', name: 'Budget build', instructions: 'Reply hello.',
    model: control.wrapModel(mock, { id, role: 'lead' }),
    ...(nativeMemory ? { memory: nativeMemory } : {}),
    tools: toolCall ? { mastra_workspace_execute_command: createTool({ id: 'mastra_workspace_execute_command',
      description: 'Execute shell command', inputSchema: z.object({ command: z.string() }),
      outputSchema: z.string(), execute: async () => { toolExecutions += 1; return 'executed'; } }) } : {},
    defaultOptions: { maxRetries: 0, abortSignal: control.signal, hooks: budget.hooks },
  });
  let stageCalls = 0;
  const stub = { generate: async () => { stageCalls += 1; return { text: 'stand-in' }; } };
  const agents = { build: agent, shipping: stub, remediation: stub, retro: stub, budget };
  openScratch(dir);
  const workflow = fullWorkflow ? buildCardPath({ agents, dir }) : createWorkflow({ id: 'budget-proof', inputSchema: z.object({ prompt: z.string() }), outputSchema: z.object({ text: z.string() }) })
    .then(createStep(agent, { retries: 0 })).commit();
  const mastra = await openMastra({ agents: { build: agent, budget }, workflow, budget,
    stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb') });
  t.after(async () => { await mastra.shutdown(); await mastra.getStorage()?.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, control, budget, mastra, agent, workflow, calls: () => calls, stops: () => stops, stageCalls: () => stageCalls, toolExecutions: () => toolExecutions };
}

test('real native agent step accounts completed inference through output processor', async t => {
  const f = await fixture(t);
  f.budget.start();
  const run = await f.mastra.getWorkflow(f.workflow.id).createRun();
  const result = await run.start({ inputData: { prompt: 'hello' } });
  assert.equal(result.status, 'success');
  const record = await f.budget.finish();
  assert.equal(f.calls(), 1);
  assert.equal(record.calls.length, 1);
  assert.ok(record.calls[0].spanId);
  assert.ok(record.calls[0].tokens > 0);
  assert.ok(record.calls[0].dollars > 0);
});

test('missing caps stop before provider admission', async t => {
  const f = await fixture(t, { dollarCap: NaN });
  assert.throws(() => f.budget.start(), /cap/);
  assert.equal(f.calls(), 0);
  assert.equal(f.control.snapshot().exitCode, 1);
});

test('unpriced identity refuses actual Agent call without provider execution', async t => {
  const f = await fixture(t, { id: 'commandcode/unpriced/model' });
  f.budget.start();
  await f.agent.generate('hello').catch(() => {});
  assert.equal(f.calls(), 0);
  assert.equal(f.control.snapshot().stop.reason, 'no_price');
});

test('a cap with no room for any call stops before the provider is called', async t => {
  const f = await fixture(t, { tokenCap: 1 });
  f.budget.start();
  await f.agent.generate('hello').catch(() => {});
  assert.equal(f.control.snapshot().stop?.reason, 'no_room_under_caps');
  await f.agent.generate('again').catch(() => {});
  await assert.rejects(f.budget.finish());
  assert.equal(f.calls(), 0);
  assert.equal(f.control.snapshot().exitCode, 1);
});

test('provider failure has no model retry and persists failure', async t => {
  const f = await fixture(t, { fail: true });
  f.budget.start();
  await f.agent.generate('hello').catch(() => {});
  assert.equal(f.calls(), 1);
  assert.equal(f.control.snapshot().stop.reason, 'model_call_failed');
  assert.ok(f.stops() > 0);
});

for (const failure of [{ dollarCap: NaN }, { tokenCap: NaN }, { id: 'unpriced/model' }, { tokenCap: 1 }, { fail: true }]) {
  test('native card workflow cannot reach Shipping or retry after ' + JSON.stringify(failure), async t => {
    const f = await fixture(t, { ...failure, fullWorkflow: true });
    const run = await f.mastra.getWorkflow(f.workflow.id).createRun();
    const result = await run.start({ inputData: { card: 'JUL-360', kind: 'product' } });
    assert.equal(result.status, 'failed');
    assert.equal(f.control.snapshot().exitCode, 1);
    assert.equal(f.stageCalls(), 0);
    assert.ok(f.calls() <= 1);
  });
}

test('native observational memory invokes explicitly priced wrapped Observer', async t => {
  const f = await fixture(t, { memory: true });
  f.budget.start();
  const options = { memory: { thread: 'budget-memory', resource: 'budget-memory' } };
  await f.agent.generate('Remember this message about a small budget proof.', options);
  await f.agent.generate('What did I ask you to remember?', options);
  const record = await f.budget.finish();
  assert.ok(record.calls.some(call => call.role === 'observer'));
  for (const call of record.calls.filter(call => call.role === 'observer')) {
    assert.equal(call.model, 'openai/gpt-6-luna');
    assert.equal(call.maxOutputTokens, MEMORY_MAX_OUTPUT_TOKENS);
    assert.ok(call.dollars > 0);
    assert.ok(call.tokens > 0);
  }
});

test('native tool hook refuses shell grep despite string output schema', async t => {
  const f = await fixture(t, { toolCall: 'grep needle example.mjs' });
  f.budget.start();
  await f.agent.generate('Search example.mjs', { maxSteps: 2 });
  const record = await f.budget.finish();
  assert.equal(f.toolExecutions(), 0);
  assert.equal(record.exploration.refusedCalls, 1);
  assert.equal(f.calls(), 2);
});

test('native Observer with no price stops the shared build budget', async t => {
  const f = await fixture(t, { memory: { unpriced: 'observer' } });
  f.budget.start();
  const options = { memory: { thread: 'unpriced-memory', resource: 'unpriced-memory' } };
  try {
    await f.agent.generate('Remember this message for later.', options);
    await f.agent.generate('Remember another message.', options);
  } catch { /* Mastra may throw or return an error; the durable stop is authoritative. */ }
  await assert.rejects(f.budget.finish());
  const stopped = f.control.snapshot();
  assert.equal(stopped.exitCode, 1);
  assert.ok(f.control.signal.aborted);
  assert.ok(f.stops() > 0);
  assert.throws(() => f.budget.start());
});

test('native card workflow stops before Shipping when the dollar cap leaves no room', async t => {
  const f = await fixture(t, { dollarCap: 0.000001, fullWorkflow: true });
  const run = await f.mastra.getWorkflow(f.workflow.id).createRun();
  const result = await run.start({ inputData: { card: 'JUL-360', kind: 'product' } });
  assert.equal(result.status, 'failed');
  assert.equal(f.stageCalls(), 0);
  assert.equal(f.calls(), 0);
  assert.equal(f.control.snapshot().exitCode, 1);
});

test('successful build budget finishes before stand-in Shipping and Retro', async t => {
  const f = await fixture(t, { fullWorkflow: true });
  const run = await f.mastra.getWorkflow(f.workflow.id).createRun();
  const result = await run.start({ inputData: { card: 'JUL-360', kind: 'machine' } });
  assert.equal(result.status, 'success');
  assert.ok(f.stageCalls() >= 2);
  assert.equal(f.control.snapshot().calls.length, 1);
  assert.equal(f.control.snapshot().phase, 'finished');
  assert.equal(f.budget.active, false);
});

test('native card workflow with observational memory stops at the budget cap (no_room_under_caps)', async t => {
  const f = await fixture(t, { tokenCap: 100, dollarCap: 0.0001, fullWorkflow: true, memory: true });
  const run = await f.mastra.getWorkflow(f.workflow.id).createRun();
  const result = await run.start({ inputData: { card: 'JUL-360', kind: 'product' } });
  assert.ok(['failed', 'tripwire'].includes(result.status), `Expected stopped workflow status, got ${result.status}`);
  assert.equal(f.stageCalls(), 0);
  assert.equal(f.calls(), 0);
  assert.equal(f.control.snapshot().exitCode, 1);
  assert.equal(f.control.snapshot().stop?.reason, 'no_room_under_caps');
});

test('native Reflector uses its own explicitly priced wrapped model', async t => {
  const f = await fixture(t, { memory: { reflect: true } });
  f.budget.start();
  const options = { memory: { thread: 'reflect-memory', resource: 'reflect-memory' } };
  await f.agent.generate('Remember one useful fact about the budget proof.', options);
  await f.agent.generate('Remember another useful fact for later.', options);
  const record = await f.budget.finish();
  assert.ok(record.calls.some(call => call.role === 'reflector'));
  for (const call of record.calls.filter(call => call.role === 'reflector')) {
    assert.equal(call.model, 'openai/gpt-6-luna');
    assert.ok(call.dollars > 0);
    assert.ok(call.tokens > 0);
  }
});
