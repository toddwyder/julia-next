// The card's spending cap, driven through real agents and the real workflow on a fake model.
// Each test names the acceptance criterion it proves, so a failing line says which promise broke.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createWorkflowStateReader } = await import('@mastra/core/workflows');
const { simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');
const { CARD_LIMIT_DOLLARS, STOP_REASONS, meteredModel, openSpending, splitModelId, spendingProcessor } = await import('./spending.mjs');
const { costRecord } = await import('./trace.mjs');
const { loadCatalog } = await import('../../dashboard/lib/model-prices.js');

const CARD = 'JUL-375-SPENDING';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

const CATALOG = {
  source: 'a fake price list',
  costs: {
    commandcode: {
      models: {
        'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
        'free/model': { cost: { input: 0, output: 0 } },
      },
    },
    openai: {
      models: {
        'gpt-6-luna': { cost: { input: 0.2, output: 1.2, cache_read: 0.02 } },
      },
    },
  },
};

const CORRECTIONS = {
  peakWindows: [
    { provider: 'commandcode', modelPrefix: 'deepseek/', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '01:00', to: '04:00', multiplier: 2 },
    { provider: 'commandcode', modelPrefix: 'deepseek/', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '06:00', to: '10:00', multiplier: 2 },
  ],
  freeModels: [],
  excludeDates: [],
  overrides: {},
};

// A fake v2 model: the answer and the token usage are ours, so the arithmetic in a test is exact.
function fakeModel({ provider = 'commandcode', modelId = DEEPSEEK, text = 'one line', usage, called = () => {} } = {}) {
  const answer = usage ?? { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 };
  return {
    specificationVersion: 'v2',
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate() {
      called();
      return {
        content: [{ type: 'text', text }],
        finishReason: 'stop',
        usage: answer,
        warnings: [],
      };
    },
    async doStream() {
      called();
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: text },
            { type: 'text-end', id: '1' },
            { type: 'finish', finishReason: 'stop', usage: answer },
          ],
        }),
        request: { body: '' },
        response: { headers: {} },
      };
    },
  };
}

function cardDirOf(dir) {
  const cardDir = join(dir, CARD);
  mkdirSync(cardDir, { recursive: true });
  return cardDir;
}

function openCase({ limit = CARD_LIMIT_DOLLARS, catalog = CATALOG, corrections = CORRECTIONS, build, memoryModel } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-'));
  const cardDir = cardDirOf(dir);
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify({ review: ['PASS'], smoke: ['PASS'] }));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  const spending = openSpending({ dir, limit, catalog, corrections, now: OFF_PEAK });
  const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });
  const agents = {
    ...(build ? { build } : {}),
    shipping: stub('looked'),
    remediation: stub('fixed line'),
    retro: stub('retro line'),
    spending,
  };
  if (memoryModel) agents.memory = memoryModel;
  return { dir, cardDir, spending, agents };
}

const PASS = 'VERDICT: PASS\nCRITERION 1: PASS';

const fakeReview = () => ({
  findPr: () => ({ pr: 1 }),
  readCard: async () => ({ identifier: CARD, title: CARD, description: '## Acceptance criteria\n- the thing works' }),
  moveCard: async () => {},
  headCommit: () => 'abc1234',
  postPrComment: () => {},
});

// A card builds in a copy made from a real repository, so a card-path case needs one.
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

// The same processor counts on both sides of a call: the input step blocks, the output step records.
function guarded(spending, ids) {
  const guard = spendingProcessor(spending, ids);
  return { inputProcessors: [guard], outputProcessors: [guard] };
}

// Off-peak, so a test that is not about peak hours prices at the advertised base rate.
const OFF_PEAK = () => new Date('2026-11-13T05:00:00Z');

// ---------------------------------------------------------------------------
// Criterion 3: one dollar total for every call the card makes.
// ---------------------------------------------------------------------------

test('the card ledger adds the lead, every helper and a memory note-taker to one total', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-sum-'));
  const spending = openSpending({ dir, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  spending.begin(CARD);

  const lead = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: 'Reply with one line.',
    model: fakeModel({ usage: { inputTokens: 100_000, outputTokens: 10_000, totalTokens: 110_000 } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
  });
  const helper = new Agent({
    id: 'pstack-bug-fix-1',
    name: 'Bug fix',
    instructions: 'Reply with one line.',
    model: fakeModel({ usage: { inputTokens: 200_000, outputTokens: 20_000, totalTokens: 220_000 } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
  });
  const memory = meteredModel(fakeModel({ usage: { inputTokens: 50_000, outputTokens: 5_000, totalTokens: 55_000 } }), {
    spending,
    ...splitModelId('openai/gpt-6-luna'),
  });

  await lead.generate('build the card');
  await helper.generate('fix the bug');
  const memoryResult = await memory.doGenerate({ prompt: [] });

  assert.equal(memoryResult.usage.inputTokens, 50_000, 'the wrapper leaves the answer untouched');
  assert.equal(spending.calls.length, 3);
  const agents =
    (100_000 * 0.15 + 10_000 * 0.6) / 1e6 +
    (200_000 * 0.15 + 20_000 * 0.6) / 1e6;
  const note = (50_000 * 0.2 + 5_000 * 1.2) / 1e6;
  assert.equal(spending.total, Number((agents + note).toFixed(12)), 'the lead, the helper and the note-taker are in the same total');
  assert.ok(spending.total > agents, 'the memory note-taker call is in the total as well');
  assert.equal(JSON.parse(readFileSync(join(dir, CARD, 'spending.json'), 'utf8')).calls.length, 3);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion 4: a peak-hour call costs the peak rate.
// ---------------------------------------------------------------------------

test('a call inside a DeepSeek peak window adds the peak rate, not the base rate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-peak-'));
  const peak = new Date('2026-11-13T02:00:00Z'); // a Friday, inside 01:00-04:00 UTC
  const offPeak = new Date('2026-11-13T05:00:00Z');

  const atPeak = openSpending({ dir, catalog: CATALOG, corrections: CORRECTIONS, now: () => peak });
  atPeak.begin(CARD);
  atPeak.record({ provider: 'commandcode', model: DEEPSEEK, usage: { inputTokens: 1_000_000, outputTokens: 0 }, at: peak });

  const atOffPeak = openSpending({ dir, catalog: CATALOG, corrections: CORRECTIONS, now: () => offPeak });
  atOffPeak.begin(`${CARD}-OFF`);
  atOffPeak.record({ provider: 'commandcode', model: DEEPSEEK, usage: { inputTokens: 1_000_000, outputTokens: 0 }, at: offPeak });

  assert.equal(atOffPeak.total, 0.15, 'off-peak is the advertised base rate');
  assert.equal(atPeak.total, 0.3, 'peak is twice the base rate');
  assert.equal(atPeak.calls[0].peak, true);
  assert.equal(atOffPeak.calls[0].peak, false);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion 5: the card stops at its limit, including across several agents.
// ---------------------------------------------------------------------------

test('helpers keep spending until the card total reaches the limit, then every agent is blocked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-limit-'));
  const spending = openSpending({ dir, limit: 0.04, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  spending.begin(CARD);

  let calls = 0;
  const helper = () => new Agent({
    id: `pstack-bug-fix-${calls + 1}`,
    name: 'Bug fix',
    instructions: 'Reply with one line.',
    model: fakeModel({ called: () => { calls += 1; }, usage: { inputTokens: 100_000, outputTokens: 0 } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
  });

  // The lead starts helper after helper. Each call is $0.015 off-peak, so the third crosses $0.04.
  for (let index = 0; index < 10; index += 1) {
    await helper().generate('do the next piece');
    if (spending.stopReason()) break;
  }

  assert.equal(spending.stopReason(), STOP_REASONS.limit);
  assert.equal(calls, 3, 'the call that crosses the limit is the last one made');
  assert.ok(spending.total <= 0.04 + 0.015, 'the total stays under the limit plus one call');

  // The stage around the lead asks the same ledger before the lead runs, so the lead is turned
  // away and the card never pays for the next call it would have started.
  assert.equal(
    spending.blockingReason({ provider: 'commandcode', model: DEEPSEEK }),
    STOP_REASONS.limit,
    'a stage that finds the limit spent turns the next agent away',
  );
  assert.equal(calls, 3);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion 6: the total carries across steps, reruns and a Studio restart.
// ---------------------------------------------------------------------------

test('the card total survives a rerun and a Studio restart because it lives in the card folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-restart-'));
  const first = openSpending({ dir, limit: 0.02, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  first.begin(CARD);
  first.record({ provider: 'commandcode', model: DEEPSEEK, usage: { inputTokens: 100_000, outputTokens: 0 } });
  assert.equal(first.total, 0.015);

  // A Studio restart builds a new ledger object over the same folder.
  const afterRestart = openSpending({ dir, limit: 0.02, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  afterRestart.begin(CARD);
  assert.equal(afterRestart.total, 0.015, 'the restart reads the money already spent');

  // The next call crosses the limit, and a rerun of the card does not start over.
  afterRestart.record({ provider: 'commandcode', model: DEEPSEEK, usage: { inputTokens: 100_000, outputTokens: 0 } });
  assert.equal(afterRestart.stopReason(), STOP_REASONS.limit);

  const rerun = openSpending({ dir, limit: 0.02, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  rerun.begin(CARD);
  assert.equal(rerun.stopReason(), STOP_REASONS.limit);
  assert.equal(rerun.blockingReason({ provider: 'commandcode', model: DEEPSEEK }), STOP_REASONS.limit);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criteria 2 and 7: an unpriceable model, and a call with no usage.
// ---------------------------------------------------------------------------

test('a model the price list cannot price stops the card at its first call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-unpriced-'));
  const spending = openSpending({ dir, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  spending.begin(CARD);

  let calls = 0;
  const agent = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: 'Reply with one line.',
    model: fakeModel({ called: () => { calls += 1; } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: 'nobody/no-such-model' })),
  });

  await agent.generate('build the card');

  assert.equal(calls, 1, 'the call happens, and it is the last one the card makes');
  assert.equal(spending.stopReason(), STOP_REASONS.unpriced);
  assert.equal(spending.total, 0, 'a call the list cannot price adds no dollars it cannot count');
  rmSync(dir, { recursive: true, force: true });
});

test('a model call with no token counts stops the card with "usage missing"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-usage-'));
  const spending = openSpending({ dir, catalog: CATALOG, corrections: CORRECTIONS, now: OFF_PEAK });
  spending.begin(CARD);

  const agent = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: 'Reply with one line.',
    model: fakeModel({ usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
  });

  await agent.generate('build the card');

  assert.equal(spending.stopReason(), STOP_REASONS.usage);
  assert.equal(spending.total, 0);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The whole card path: a card that crosses its limit stops with a report.
// ---------------------------------------------------------------------------

test('the card path stops a card that crosses its limit and writes the reason into the report', async () => {
  const spendingDir = mkdtempSync(join(tmpdir(), 'flow-spending-path-'));
  const catalog = CATALOG;
  // $0.001 for a 1,000-token call, so a small limit crosses on the first build.
  const { dir, cardDir, agents } = {
    dir: spendingDir,
    cardDir: cardDirOf(spendingDir),
    agents: (() => {
      const spending = openSpending({ dir: spendingDir, limit: 0.0005, catalog, corrections: CORRECTIONS, now: OFF_PEAK });
      const build = new Agent({
        id: 'flow-build',
        name: 'Lead',
        instructions: 'Reply with one line.',
        model: fakeModel({ text: 'built line', usage: { inputTokens: 10_000, outputTokens: 1_000, totalTokens: 11_000 } }),
        ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
      });
      const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });
      return { build, shipping: stub('looked'), remediation: stub('fixed line'), retro: stub('retro line'), spending };
    })(),
  };
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify({ review: ['PASS'], smoke: ['PASS'] }));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  const repo = studioRepo(dir);

  const workflow = buildCardPath({ agents, dir, repo, check: { run: async () => ({ ok: true }) }, review: fakeReview() });
  const mastra = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'product' } });

  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true, 'the card stops rather than reaching Todd');
  assert.equal(result.result.finished, true);
  const report = readFileSync(join(cardDir, 'reports', `${CARD}.md`), 'utf8');
  assert.match(report, /Part: Spending/);
  assert.match(report, /card spending limit reached/);
  assert.equal(agents.spending.stopReason(), STOP_REASONS.limit);
  rmSync(dir, { recursive: true, force: true });
});


// Criterion 3 is a dollar figure in two places at once. The ledger the cap reads and the Studio
// trace record cost.json comes from must agree, so this test runs one real card call, reads both
// and compares. Both sides price from the machine's own price list, the one the picker shows.
test('the Studio record and the card ledger agree on what the card spent', async () => {
  let catalog;
  try {
    catalog = loadCatalog();
  } catch {
    return; // No price list on this machine, so there is nothing to compare.
  }
  const dir = mkdtempSync(join(tmpdir(), 'flow-spending-record-'));
  const cardDir = cardDirOf(dir);
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify({ review: ['PASS'], smoke: ['PASS'] }));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  // The runner's clock, so the ledger and the trace pick the same peak or off-peak rate.
  const spending = openSpending({ dir, catalog, corrections: CORRECTIONS });
  const build = new Agent({
    id: 'flow-build',
    name: 'Lead',
    instructions: 'Reply with one line.',
    model: fakeModel({ text: 'built line', usage: { inputTokens: 100_000, outputTokens: 10_000, totalTokens: 110_000 } }),
    ...guarded(spending, () => ({ provider: 'commandcode', model: DEEPSEEK })),
  });
  const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });
  const agents = { build, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending };
  const repo = studioRepo(dir);

  const workflow = buildCardPath({ agents, dir, repo, check: { run: async () => ({ ok: true }) }, review: fakeReview() });
  const mastra = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  let result = await run.start({ inputData: { card: CARD, kind: 'product' } });
  while (result.status === 'suspended') {
    const state = await wf.getWorkflowRunById(run.runId);
    const open = createWorkflowStateReader(state).getSuspendedStep();
    result = await run.resume({ step: open.stepId, resumeData: { request: open.suspendPayload.request, answer: 'yes' } });
  }
  await mastra.shutdown();

  const record = await costRecord(join(dir, 'trace.duckdb'));
  assert.equal(spending.calls.length, 1);
  assert.ok(record.usd > 0, `the trace prices the call: ${record.costNote}`);
  assert.equal(spending.total, Number(record.usd.toFixed(12)));
  rmSync(dir, { recursive: true, force: true });
});
