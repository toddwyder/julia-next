import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createBuildGate } from './agents.mjs';

const scratch = join(homedir(), '.local/state/julia-scratch');
mkdirSync(scratch, { recursive: true });

function fixture(command) {
  const repo = mkdtempSync(join(scratch, 'build-gate-'));
  mkdirSync(join(repo, 'graphify-out'));
  writeFileSync(join(repo, 'graphify-out/graph.json'), JSON.stringify({ nodes: [{ id: 'a', label: 'a', file: 'a.mjs' }], links: [] }));
  const gate = createBuildGate({ repo });
  let calls = 0;
  let executions = 0;
  const spy = () => { calls += 1; };
  const mock = createMockModel({ mockText: 'hello', spyGenerate: spy });
  const base = mock.doGenerate.bind(mock);
  mock.doGenerate = async options => {
    if (calls) return base(options);
    spy();
    return { content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'mastra_workspace_execute_command', input: JSON.stringify({ command }) }],
      finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 10 }, warnings: [] };
  };
  const agent = new Agent({ id: 'gate-build', name: 'Gate build', instructions: 'Reply hello.', model: mock,
    tools: { mastra_workspace_execute_command: createTool({ id: 'mastra_workspace_execute_command', description: 'Execute shell command',
      inputSchema: z.object({ command: z.string() }), outputSchema: z.string(), execute: async () => { executions += 1; return 'executed'; } }) },
    defaultOptions: { maxRetries: 0, hooks: gate.hooks } });
  return { gate, agent, calls: () => calls, executions: () => executions };
}

test('the exploration gate refuses a shell grep before the first graph query, as before', async () => {
  const f = fixture('grep needle example.mjs');
  f.gate.start();
  await f.agent.generate('Search example.mjs', { maxSteps: 2 });
  const record = f.gate.finish();
  assert.equal(f.executions(), 0);
  assert.equal(record.exploration.refusedCalls, 1);
  assert.equal(f.calls(), 2);
});

test('the gate refuses every tool call while no build is active', async () => {
  const f = fixture('graphify query "where is a"');
  assert.equal(f.gate.active, false);
  await f.agent.generate('Ask the graph', { maxSteps: 2 }).catch(() => {});
  assert.equal(f.executions(), 0);
  f.gate.start();
  assert.equal(f.gate.active, true);
  f.gate.finish();
  assert.equal(f.gate.active, false);
});

test('finishing with a truncated graph answer still unanswered fails the build', () => {
  const f = fixture('graphify query "x"');
  f.gate.start();
  const call = { toolName: 'mastra_workspace_execute_command', input: { command: 'graphify query "x" --budget 200' } };
  assert.equal(f.gate.hooks.beforeToolCall(call), undefined);
  f.gate.hooks.afterToolCall({ ...call, output: '[!] TRUNCATED: showing 2 of 12 nodes (~100-token budget). Raise --budget or narrow the query.\n' });
  assert.throws(() => f.gate.finish(), /incomplete_graph_answer/);
});
