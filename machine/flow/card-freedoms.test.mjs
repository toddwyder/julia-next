// The card's freedoms after the exploration gate, the retry overrides and the output limits came
// out: an agent reads and searches freely with Graphify as one tool among the rest, a transient
// model failure is retried the way Mastra retries by default, an answer runs to the model's own
// length while the card's dollar ledger still ends a runaway, memory note-takers run on the free
// model the card picked and cost nothing, and every card report shows the tokens read per model.
// Every call here is a fake AI SDK model, so the dollars in each assertion are exact.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { z } from 'zod';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createTool } = await import('@mastra/core/tools');
const { simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { Memory } = await import('@mastra/memory');
const { LibSQLStore } = await import('@mastra/libsql');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');
const { readSpans, mergedSpans } = await import('./trace.mjs');
const { openSpending, meteredModel, spendingProcessor, splitModelId } = await import('./spending.mjs');

const CARD = 'JUL-375-FREE';
const FREE = 'commandcode/inclusionai/ling-3.1-flash:free';
const PAID = 'deepseek/deepseek-v4.1-flash';

const CATALOG = {
  source: 'a fake price list',
  costs: {
    commandcode: {
      models: {
        'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
      },
    },
  },
};

const CORRECTIONS = { freeModels: [FREE] };

// Off peak, so every paid call below prices at the advertised base rate.
const OFF_PEAK = () => new Date('2026-11-13T05:00:00Z');
const ONE_CALL_USD = Number(((100_000 * 0.15) / 1e6).toFixed(12)); // $0.015 for 100,000 input tokens

function fakeModel({
  usage,
  text = 'one line',
  called = () => {},
  toolCalls = null,
  failOn = null,
  modelId = PAID,
  optionsSeen = null,
}) {
  const answer = usage ?? { inputTokens: 100_000, outputTokens: 0, totalTokens: 100_000 };
  const call = () => {
    called();
    // A transient failure that Mastra's own retry processor treats as worth retrying.
    if (failOn?.()) throw Object.assign(new Error('socket hang up'), { isRetryable: true });
  };
  return {
    specificationVersion: 'v2',
    provider: 'commandcode',
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

// A real agent on the fake model, counted by the ledger the way the machine wires it.
function meteredAgent({ id, spending, called = () => {}, usage, modelOptions = {}, processorOptions, ...extra }) {
  const guard = spendingProcessor(spending, () => ({ provider: 'commandcode', model: PAID }), processorOptions);
  return new Agent({
    id,
    name: id,
    instructions: 'Reply with one line.',
    model: fakeModel({ usage, called, ...modelOptions }),
    inputProcessors: [guard],
    outputProcessors: [guard],
    ...extra,
  });
}

// A stand-in stage that answers without calling a model, so only the calls under test cost money.
const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });

// The reviewer's answer for the one criterion the fake card lists.
const PASS = 'VERDICT: PASS\nCRITERION 1: PASS';

// Shipping reads the card and its pull request through these four calls, so a test answers them
// from here instead of reaching GitHub.
const fakeReview = () => ({
  findPr: () => ({ pr: 1 }),
  readCard: async () => ({ identifier: CARD, title: CARD, description: '## Acceptance criteria\n- the thing works' }),
  headCommit: () => 'abc1234',
  postPrComment: () => {},
});

// A card builds in a copy made from a real repository, so each case needs one with a main branch.
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

function openCase({ limit, verdicts }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-freedoms-'));
  const repo = studioRepo(dir);
  const cardDir = join(dir, CARD);
  mkdirSync(cardDir, { recursive: true });
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify(verdicts));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  return { dir, repo, cardDir };
}

async function runCard({ dir, repo, agents }) {
  const workflow = buildCardPath({ dir, repo, review: fakeReview(), agents });
  const studio = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const run = await studio.getWorkflow(workflow.id).createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'product' } });
  await studio.shutdown();
  return result;
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
  // Graphify is offered exactly like any other tool: the fake Lead simply does not call it.
  const graphQuery = createTool({
    id: 'graphify_query',
    description: 'Ask the code graph.',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async () => ({ answer: 'the graph answer' }),
  });
  return { counts, tools: { grep, read_file: readFile, graphify_query: graphQuery } };
};

// ---------------------------------------------------------------------------
// Criterion A: the card reads and searches freely, Graphify is one tool among the rest.
// ---------------------------------------------------------------------------

test('a card reads and searches freely, and Graphify is offered as one tool among the rest', async t => {
  const { dir, repo } = openCase({ limit: 4, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spending = openSpending({ dir, limit: 4, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  const { counts, tools } = searching();

  let leadCalls = 0;
  const lead = meteredAgent({
    id: 'flow-build',
    spending,
    tools,
    modelOptions: {
      called: () => { leadCalls += 1; },
      // Two raw searches and one file read, with no graph query first.
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

  const result = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending },
  });

  assert.equal(result.status, 'suspended', 'the card carried on to the wait for Todd');
  assert.equal(counts.grep, 2, 'both searches ran');
  assert.equal(counts.read_file, 1, 'the file read ran');

  const offered = Object.keys(await lead.listTools());
  assert.ok(offered.includes('grep') && offered.includes('read_file'), 'the reading tools are offered');
  assert.ok(offered.includes('graphify_query'), 'Graphify is offered as one tool among the rest');

  // The Studio record shows the tool calls and no gate refusal anywhere in the run.
  const spans = mergedSpans(await readSpans(join(dir, 'trace.duckdb')));
  const toolSpans = spans.filter(span => String(span.spanType ?? '').includes('tool'));
  assert.ok(toolSpans.length >= 1, `the Studio record shows tool calls (found ${toolSpans.length})`);
  const record = JSON.stringify(spans);
  assert.doesNotMatch(record, /First raw exploration/);
});

// ---------------------------------------------------------------------------
// Criterion B: a transient failure is retried the way Mastra retries by default.
// ---------------------------------------------------------------------------

test('a transient model failure is retried through Mastra default retry, and the card carries on', async t => {
  const { dir, repo } = openCase({ limit: 4, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spending = openSpending({ dir, limit: 4, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });

  let attempts = 0;
  const lead = meteredAgent({
    id: 'flow-build',
    spending,
    modelOptions: { called: () => { attempts += 1; }, failOn: () => attempts === 1, text: 'built it' },
    defaultOptions: { maxSteps: 10 },
  });

  // No retry setting of the machine's own; Mastra's defaults are the whole configuration.
  assert.equal((await lead.getDefaultOptions()).maxRetries, undefined);

  const result = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending },
  });

  assert.equal(attempts, 2, 'the failed call was attempted again');
  assert.equal(result.status, 'suspended', 'the card carried on to the wait for Todd');
  assert.equal(result.result?.stopped, undefined, 'the card did not stop');
  // Only the finished call is billed; the failed attempt never reached the ledger.
  assert.equal(spending.calls.length, 1);
  assert.equal(spending.total, ONE_CALL_USD);
});

// ---------------------------------------------------------------------------
// Criterion C: an answer runs to the model's own length limit, and the card cap ends a runaway.
// ---------------------------------------------------------------------------

test('no output limit reaches the model, a long answer passes, and the card cap still ends a runaway', async t => {
  const { dir, repo } = openCase({ limit: 4, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spending = openSpending({ dir, limit: 4, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });

  const limits = [];
  const long = 'x'.repeat(60_000);
  const lead = meteredAgent({
    id: 'flow-build',
    spending,
    modelOptions: { text: long, optionsSeen: options => limits.push(options.maxOutputTokens) },
    defaultOptions: { maxSteps: 10 },
  });
  assert.equal((await lead.getDefaultOptions()).modelSettings?.maxOutputTokens, undefined);

  const result = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending },
  });

  assert.ok(limits.length >= 1, 'the model was called');
  assert.ok(limits.every(limit => limit === undefined), 'the machine set no output limit');
  assert.equal(result.status, 'suspended', 'the long answer passed through without being cut');

  // A runaway agent: every model call asks for more work, and the card's dollars end it.
  const runawayDir = mkdtempSync(join(tmpdir(), 'flow-runaway-'));
  t.after(() => rmSync(runawayDir, { recursive: true, force: true }));
  const cardDir = join(runawayDir, CARD);
  mkdirSync(cardDir, { recursive: true });
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify({ review: ['PASS'], smoke: ['PASS'] }));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(runawayDir);

  const runawaySpending = openSpending({ dir: runawayDir, limit: 0.03, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  const again = createTool({
    id: 'again',
    description: 'Ask for more work.',
    inputSchema: z.object({}),
    outputSchema: z.string(),
    execute: async () => 'more',
  });
  let runawayCalls = 0;
  const runaway = meteredAgent({
    id: 'flow-build',
    spending: runawaySpending,
    tools: { again },
    processorOptions: { refuseAfterStop: true },
    modelOptions: {
      called: () => { runawayCalls += 1; },
      toolCalls: () => [{ name: 'again', input: {} }],
    },
    defaultOptions: { maxSteps: 50 },
  });

  const runawayResult = await runCard({
    dir: runawayDir,
    repo: studioRepo(runawayDir),
    agents: { build: runaway, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending: runawaySpending },
  });

  assert.equal(runawayResult.result.stopped, true, 'the cap ended the runaway agent');
  assert.equal(runawaySpending.stopReason(), 'card spending limit reached');
  assert.ok(runawayCalls < 50, `the runaway stopped at ${runawayCalls} calls`);
});

// ---------------------------------------------------------------------------
// Criterion D: memory note-takers run on the free model the card picked, at $0.
// ---------------------------------------------------------------------------

test('memory runs on the free model the card picked, and its calls show in the card total at zero', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-free-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spending = openSpending({ dir, limit: 4, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });

  spending.begin(CARD);
  assert.equal(spending.memoryModel, FREE, 'the card picked the free model from the price list');

  // The card's own note-takers are pointed at that pick, not at a name written in the machine.
  const ledger = JSON.parse(readFileSync(join(dir, CARD, 'spending.json'), 'utf8'));
  assert.equal(ledger.memoryModel, FREE, 'a restart reuses the same free model');

  const memory = meteredModel(
    fakeModel({ modelId: 'inclusionai/ling-3.1-flash:free', usage: { inputTokens: 5_000, outputTokens: 400, totalTokens: 5_400 } }),
    { spending, agent: 'memory', ...splitModelId(FREE) },
  );
  await memory.doGenerate({});

  const call = spending.calls.at(-1);
  assert.equal(call.agent, 'memory', 'the call is attributed to the note-takers');
  assert.equal(call.usd, 0, 'the free model costs nothing');
  assert.equal(spending.total, 0, 'the card total did not move');
  assert.equal(call.inputTokens, 5_000, 'its tokens are still counted');
});

// ---------------------------------------------------------------------------
// Criterion E: a memory note-taker's failed call is retried the way Mastra retries by default.
// ---------------------------------------------------------------------------

test('a memory note-taker retries a failed call the way Mastra retries by default', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let attempts = 0;
  const model = fakeModel({
    modelId: 'inclusionai/ling-3.1-flash:free',
    usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
    text: '<observations>\n- the card is green\n</observations>',
    called: () => { attempts += 1; },
    failOn: () => attempts === 1,
  });

  const storage = new LibSQLStore({ id: 'memory-retries', url: `file:${join(dir, 'memory.db')}` });
  const memory = new Memory({
    storage,
    options: {
      observationalMemory: {
        // Mastra's own settings for the card's note-takers, except the token thresholds,
        // which the test lowers so one short message is observed.
        observation: { model, messageTokens: 5, bufferTokens: 2 },
        reflection: { model },
      },
    },
  });

  const retries = (await memory.getMergedThreadConfig({})).observationalMemory;
  assert.equal(retries.observation.maxRetries, undefined, 'the note-taker keeps Mastra default retry ladder');

  const observer = new Agent({ id: 'observer-probe', name: 'observer-probe', instructions: 'Answer one line.', model, memory });
  await observer.generate('remember this: the card is green', { memory: { thread: 'thread-1', resource: 'resource-1' } });

  assert.ok(attempts >= 2, `the failed note-taker call was attempted again (attempts ${attempts})`);
});

// ---------------------------------------------------------------------------
// Criterion G: every card report shows the tokens the lead and each helper spent reading,
// grouped by model.
// ---------------------------------------------------------------------------

test('a card report shows the tokens the lead and each helper read, grouped by model', async t => {
  const { dir, repo, cardDir } = openCase({ limit: 0.02, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spending = openSpending({ dir, limit: 0.02, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });

  let leadCalls = 0;
  const helper = meteredAgent({
    id: 'pstack-bug-fix-1',
    spending,
    usage: { inputTokens: 100_000, outputTokens: 300, totalTokens: 100_300 },
    modelOptions: { text: 'helper done' },
  });
  const lead = meteredAgent({
    id: 'flow-build',
    spending,
    agents: { pstackBugFix1: helper },
    processorOptions: { refuseAfterStop: true },
    usage: { inputTokens: 50_000, outputTokens: 500, totalTokens: 50_500 },
    modelOptions: {
      called: () => { leadCalls += 1; },
      toolCalls: () => (leadCalls === 1 ? [{ name: 'agent-pstackBugFix1', input: { prompt: 'do the next piece' } }] : null),
    },
    defaultOptions: { maxSteps: 10 },
  });

  const result = await runCard({
    dir,
    repo,
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending },
  });
  assert.equal(result.result.stopped, true, 'the helper call crossed the cap, so the card stopped');

  const report = readFileSync(join(cardDir, 'reports', `${CARD}.md`), 'utf8');
  assert.match(report, /## Tokens read/);
  const leadRow = report.split('\n').find(line => line.startsWith('| Lead |'));
  const helperRow = report.split('\n').find(line => line.startsWith('| pstack-bug-fix-1 |'));
  assert.ok(leadRow, 'the Lead has a row');
  assert.ok(helperRow, 'the helper has its own row');
  assert.match(leadRow, new RegExp(`\\| commandcode/${PAID} \\|`), 'the Lead row names its model');
  assert.match(helperRow, new RegExp(`\\| commandcode/${PAID} \\|`), 'the helper row names its model');
  assert.match(leadRow, /\| 1 \| 50,000 \|/, 'the Lead row shows the tokens it read');
  assert.match(helperRow, /\| 1 \| 100,000 \|/, 'the helper row shows the tokens it read');
});
