import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { createTool } from '@mastra/core/tools';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { COST_LIMIT_DOLLARS, costGuard } from './agents.mjs';
import { openMastra } from './mastra.mjs';

// openai/gpt-6.1-sol in Mastra's table: $2 per million input, $10 per million output.
const CALL_MS = 300;
const OUTPUT_PER_CALL = 300_000;
const DOLLARS_PER_CALL = (OUTPUT_PER_CALL * 10) / 1e6;

function streamModel({ id = 'gpt-6.1-sol', outputTokens = 0, toolCall, text = 'done', onCall = () => {} }) {
  const mock = createMockModel({ mockText: text });
  mock.provider = 'openai';
  mock.modelId = id;
  const usage = { inputTokens: 0, outputTokens, totalTokens: outputTokens };
  mock.doStream = async () => {
    await new Promise(resolve => setTimeout(resolve, CALL_MS));
    onCall();
    return { stream: new ReadableStream({ start(stream) {
      stream.enqueue({ type: 'stream-start', warnings: [] });
      if (toolCall) {
        stream.enqueue({ type: 'tool-call', toolCallId: `c${Math.random()}`, toolName: toolCall.name, input: JSON.stringify(toolCall.input) });
      } else {
        stream.enqueue({ type: 'text-start', id: 't' });
        stream.enqueue({ type: 'text-delta', id: 't', delta: text });
        stream.enqueue({ type: 'text-end', id: 't' });
      }
      stream.enqueue({ type: 'finish', finishReason: toolCall ? 'tool-calls' : 'stop', usage });
      stream.close();
    } }) };
  };
  return mock;
}

const options = { maxSteps: 40 };

async function openStudioLike(t, agents, entry) {
  const dir = mkdtempSync(join(tmpdir(), 'cost-guard-'));
  const workflow = createWorkflow({ id: 'guard-proof', inputSchema: z.object({ prompt: z.string() }), outputSchema: z.object({ text: z.string() }) })
    .then(createStep(entry, { retries: 0 })).commit();
  const mastra = await openMastra({ agents, workflow, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb') });
  t.after(async () => { await mastra.shutdown(); await mastra.getStorage()?.close(); rmSync(dir, { recursive: true, force: true }); });
  return mastra;
}

const again = createTool({ id: 'again', description: 'again', inputSchema: z.object({}), outputSchema: z.string(), execute: async () => 'ok' });

test('a Lead that keeps delegating stops once helper spending passes $4', async t => {
  let helperCalls = 0;
  let leadCalls = 0;
  const helper = new Agent({ id: 'helper', name: 'Helper', description: 'Does one task.', instructions: 'Answer.',
    model: streamModel({ outputTokens: OUTPUT_PER_CALL, onCall: () => { helperCalls += 1; } }),
    inputProcessors: [costGuard()], defaultOptions: options });
  const lead = new Agent({ id: 'lead', name: 'Lead', instructions: 'Delegate.',
    model: streamModel({ id: 'unpriced-lead', toolCall: { name: 'agent-helper', input: { prompt: 'work' } }, onCall: () => { leadCalls += 1; } }),
    agents: { helper }, inputProcessors: [costGuard()], defaultOptions: options });
  const mastra = await openStudioLike(t, { lead, helper }, lead);
  const result = await (await mastra.getWorkflow('guard-proof').createRun()).start({ inputData: { prompt: 'go' } });
  const spent = helperCalls * DOLLARS_PER_CALL;
  console.log(`status=${result.status} leadCalls=${leadCalls} helperCalls=${helperCalls} spent=$${spent.toFixed(2)}`);
  assert.ok(spent > COST_LIMIT_DOLLARS, `stopped before spending passed the limit: $${spent}`);
  assert.ok(leadCalls < 40, 'the Lead ran to its step limit');
  assert.ok(spent <= COST_LIMIT_DOLLARS + 2 * DOLLARS_PER_CALL, `overshoot: $${spent}`);
});

test('known limit: one agent looping inside a single run is not stopped, because Mastra saves its cost when the run ends', async t => {
  let calls = 0;
  const looper = new Agent({ id: 'looper', name: 'Looper', instructions: 'Loop.',
    model: streamModel({ outputTokens: OUTPUT_PER_CALL, toolCall: { name: 'again', input: {} }, onCall: () => { calls += 1; } }),
    tools: { again }, inputProcessors: [costGuard()], defaultOptions: { ...options, maxSteps: 8 } });
  const mastra = await openStudioLike(t, { looper }, looper);
  await (await mastra.getWorkflow('guard-proof').createRun()).start({ inputData: { prompt: 'go' } });
  console.log(`single-run loop made ${calls} calls, $${(calls * DOLLARS_PER_CALL).toFixed(2)}`);
  assert.equal(calls, 8);
});
