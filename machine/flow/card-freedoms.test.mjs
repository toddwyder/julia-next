// The card's freedoms: an agent reads and searches freely with Graphify as one tool among the rest,
// a transient model failure is retried the way Mastra retries by default, an answer runs to the
// model's own length while Mastra's resource-scoped TokenCostControl ends a runaway.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { z } from 'zod';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { TokenCostControl } = await import('@mastra/core/processors');
const { createTool } = await import('@mastra/core/tools');
const { simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');

const CARD = 'JUL-375-FREE';

function fakeModel({
  usage,
  text = 'one line',
  called = () => {},
  toolCalls = null,
  failOn = null,
  modelId = 'gpt-6.1-sol',
  provider = 'openai',
  optionsSeen = null,
} = {}) {
  const answer = usage ?? { inputTokens: 100_000, outputTokens: 0, totalTokens: 100_000 };
  const call = () => {
    called();
    if (failOn?.()) throw Object.assign(new Error('socket hang up'), { isRetryable: true });
  };
  return {
    specificationVersion: 'v2',
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      optionsSeen?.(options);
      call();
      return { content: [{ type: 'text', text }], finishReason: 'stop', usage: answer, warnings: [] };
    },
    async doStream(options) {
      optionsSeen?.(options);
      call();
      const calls = typeof toolCalls === 'function' ? toolCalls() : toolCalls;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...(calls
              ? calls.map((toolCall, index) => ({ type: 'tool-call', toolCallId: `t${index}`, toolName: toolCall.name, input: JSON.stringify(toolCall.input ?? {}) }))
              : [
                { type: 'text-start', id: '1' },
                { type: 'text-delta', id: '1', delta: text },
                { type: 'text-end', id: '1' },
              ]),
            { type: 'finish', finishReason: calls ? 'tool-calls' : 'stop', usage: answer },
          ],
        }),
        request: { body: '' },
        response: { headers: {} },
      };
    },
  };
}

const taskToolStubs = () => {
  const stubTool = id => createTool({
    id,
    description: id,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}).passthrough(),
    execute: async () => ({ ok: true }),
  });
  return {
    task_write: stubTool('task_write'),
    task_update: stubTool('task_update'),
    task_complete: stubTool('task_complete'),
    task_check: stubTool('task_check'),
  };
};

function guardedAgent({ id, limit = 4, called = () => {}, usage, modelOptions = {}, tools, ...extra }) {
  return new Agent({
    id,
    name: id,
    instructions: 'Reply with one line.',
    model: fakeModel({ usage, called, ...modelOptions }),
    inputProcessors: [new TokenCostControl({ maxCost: limit, scope: 'resource' })],
    tools: id === 'flow-build' ? { ...taskToolStubs(), ...tools } : tools,
    ...extra,
  });
}

const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });
const PASS = 'VERDICT: PASS\nCRITERION 1: PASS';

const fakeReview = () => ({
  findPr: () => ({ pr: 1 }),
  readCard: async () => ({ identifier: CARD, title: CARD, description: '## Acceptance criteria\n- the thing works' }),
  moveCard: async () => {},
  headCommit: () => 'abc1234',
  postPrComment: () => {},
});

function studioRepo(dir) {
  const repo = join(dir, 'studio');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('add', '-A');
  git('-c', 'user.email=flow@test', '-c', 'user.name=flow', 'commit', '--quiet', '-m', 'main');
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  return repo;
}

function openCase({ verdicts }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-freedoms-'));
  const repo = studioRepo(dir);
  const cardDir = join(dir, CARD);
  mkdirSync(cardDir, { recursive: true });
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify(verdicts));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  return { dir, repo, cardDir };
}

async function readMastraSpans(mastra) {
  const obs = await mastra.getStorage().getStore('observability');
  const { spans } = await obs.listTraces({ pagination: { page: 0, perPage: 50 } });
  const loaded = await Promise.all(spans.map(s => obs.getTrace({ traceId: s.traceId })));
  return loaded.flatMap(t => t?.spans ?? []);
}

async function runCard({ dir, repo, agents }) {
  const workflow = buildCardPath({ dir, repo, check: { run: async () => ({ ok: true }) }, review: fakeReview(), agents });
  const studio = await openMastra({ card: CARD, agents, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const run = await studio.getWorkflow(workflow.id).createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'product' } });
  const spans = await readMastraSpans(studio);
  await studio.shutdown();
  return { result, spans };
}

const searching = () => {
  const counts = { grep: 0, read_file: 0 };
  const grep = createTool({
    id: 'grep',
    description: 'Search the workspace.',
    inputSchema: z.object({ pattern: z.string() }),
    outputSchema: z.object({ hits: z.number() }),
    execute: async () => { counts.grep += 1; return { hits: 0 }; },
  });
  const readFile = createTool({
    id: 'read_file',
    description: 'Read a file.',
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    execute: async () => { counts.read_file += 1; return { text: 'file text' }; },
  });
  const graphQuery = createTool({
    id: 'graphify_query',
    description: 'Ask the code graph.',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async () => ({ answer: 'the graph answer' }),
  });
  return { counts, tools: { grep, read_file: readFile, graphify_query: graphQuery } };
};

test('a card reads and searches freely, and Graphify is offered as one tool among the rest', async t => {
  const { dir, repo } = openCase({ verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const { counts, tools } = searching();

  let leadCalls = 0;
  const lead = guardedAgent({
    id: 'flow-build',
    tools,
    modelOptions: {
      called: () => { leadCalls += 1; },
      toolCalls: () => (leadCalls === 1
        ? [
          { name: 'grep', input: { pattern: 'gate' } },
          { name: 'grep', input: { pattern: 'maxRetries' } },
          { name: 'read_file', input: { path: 'machine/flow/agents.mjs' } },
        ]
        : null),
    },
    defaultOptions: { maxSteps: 10 },
  });

  const { result, spans } = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line') },
  });

  assert.equal(result.status, 'suspended', 'the card carried on to the wait for Todd');
  assert.equal(counts.grep, 2, 'both searches ran');
  assert.equal(counts.read_file, 1, 'the file read ran');

  const offered = Object.keys(await lead.listTools());
  assert.ok(offered.includes('grep') && offered.includes('read_file'), 'the reading tools are offered');
  assert.ok(offered.includes('graphify_query'), 'Graphify is offered as one tool among the rest');

  const toolSpans = spans.filter(span => String(span.spanType ?? '').includes('tool'));
  assert.ok(toolSpans.length >= 1, `the Studio record shows tool calls (found ${toolSpans.length})`);
  assert.doesNotMatch(JSON.stringify(spans), /First raw exploration/);
});

test('a transient model failure is retried through Mastra default retry, and the card carries on', async t => {
  const { dir, repo } = openCase({ verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  let attempts = 0;
  const lead = guardedAgent({
    id: 'flow-build',
    modelOptions: { called: () => { attempts += 1; }, failOn: () => attempts === 1, text: 'built it' },
    defaultOptions: { maxSteps: 10 },
  });

  assert.equal((await lead.getDefaultOptions()).maxRetries, undefined);

  const { result } = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line') },
  });

  assert.equal(attempts, 2, 'the failed call was attempted again');
  assert.equal(result.status, 'suspended', 'the card carried on to the wait for Todd');
  assert.equal(result.result?.stopped, undefined, 'the card did not stop');
});

test('no output limit reaches the model, a long answer passes, and TokenCostControl stops a runaway', async t => {
  const { dir, repo } = openCase({ verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  const limits = [];
  const long = 'x'.repeat(60_000);
  const lead = guardedAgent({
    id: 'flow-build',
    modelOptions: { text: long, optionsSeen: options => limits.push(options.maxOutputTokens) },
    defaultOptions: { maxSteps: 10 },
  });
  assert.equal((await lead.getDefaultOptions()).modelSettings?.maxOutputTokens, undefined);

  const { result } = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line') },
  });

  assert.ok(limits.length >= 1, 'the model was called');
  assert.ok(limits.every(limit => limit === undefined), 'the machine set no output limit');
  assert.equal(result.status, 'suspended', 'the long answer passed through without being cut');

  const { dir: runawayDir, repo: runawayRepo, cardDir: runawayCardDir } = openCase({ verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => { try { rmSync(runawayDir, { recursive: true, force: true }); } catch {} });

  let runawayCalls = 0;
  const runaway = guardedAgent({
    id: 'flow-build',
    limit: 0.05,
    usage: { inputTokens: 100_000, outputTokens: 10_000, totalTokens: 110_000 },
    modelOptions: {
      provider: 'openai',
      modelId: 'gpt-4o',
      called: () => { runawayCalls += 1; },
      text: 'round 1 done',
    },
  });
  const guardedShipping = guardedAgent({
    id: 'flow-shipping',
    limit: 0.05,
    modelOptions: { provider: 'openai', modelId: 'gpt-4o', text: PASS },
  });

  const { result: runawayResult } = await runCard({
    dir: runawayDir,
    repo: runawayRepo,
    agents: { build: runaway, shipping: guardedShipping, remediation: stub('fixed line'), retro: stub('retro line') },
  });

  assert.equal(runawayResult.result.stopped, true, 'TokenCostControl ended the card at the limit');
  const report = readFileSync(join(runawayCardDir, 'reports', `${CARD}.md`), 'utf8');
  assert.match(report, /Part: Spending/);
  assert.match(report, /\$0\.05/);
  assert.equal(runawayCalls, 1, 'no further model call ran once the $0.05 resource limit was crossed');
});
