// The three proofs Todd asked for after the cap shipped: a card killed while Studio waits for him,
// a card whose Shipping keeps failing, and a lead that starts 150 helpers at once. Every call here
// is a fake AI SDK model, so the dollars in each assertion are exact.

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
const { STOP_REASONS, openSpending, spendingProcessor, helperStartHook, HELPER_CONCURRENCY } = await import('./spending.mjs');

const CARD = 'JUL-375-CAP';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';

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

// Off peak, so every call below prices at the advertised base rate.
const OFF_PEAK = () => new Date('2026-11-13T05:00:00Z');
const ONE_CALL_USD = Number(((100_000 * 0.15) / 1e6).toFixed(12)); // $0.015 for 100,000 input tokens

function fakeModel({ usage, text = 'one line', called = () => {}, done = () => {}, toolCalls = null, delayMs = 0 }) {
  const answer = usage ?? { inputTokens: 100_000, outputTokens: 0, totalTokens: 100_000 };
  return {
    specificationVersion: 'v2',
    provider: 'commandcode',
    modelId: DEEPSEEK,
    supportedUrls: {},
    async doGenerate() {
      called();
      return { content: [{ type: 'text', text }], finishReason: 'stop', usage: answer, warnings: [] };
    },
    async doStream() {
      called();
      const calls = typeof toolCalls === 'function' ? toolCalls() : toolCalls;
      // A call that takes a moment is what lets the test see how many run at once.
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      done();
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...(calls
              ? calls.map((call, index) => ({ type: 'tool-call', toolCallId: `t${index}`, toolName: call.name, input: JSON.stringify(call.input) }))
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

// A real agent on the fake model, counted by the ledger. `ids` is fixed the way the picker fixes it.
function meteredAgent({ id, spending, called = () => {}, usage, modelOptions = {}, processorOptions, ...extra }) {
  const guard = spendingProcessor(spending, () => ({ provider: 'commandcode', model: DEEPSEEK }), processorOptions);
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

const PASS = 'VERDICT: PASS\nCRITERION 1: PASS';
const FAIL = 'VERDICT: FAIL\nCRITERION 1: FAIL';

const fakeReview = () => ({
  findPr: () => ({ pr: 1 }),
  readCard: async () => ({ identifier: CARD, title: CARD, description: '## Acceptance criteria\n- the thing works' }),
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

// A stand-in stage that answers without calling a model, so only the calls under test cost money.
const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });

function openCase({ limit, verdicts }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-proofs-'));
  const repo = studioRepo(dir);
  const cardDir = join(dir, CARD);
  mkdirSync(cardDir, { recursive: true });
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify(verdicts));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  return { dir, repo, cardDir };
}

function readReport(cardDir) {
  return readFileSync(join(cardDir, 'reports', `${CARD}.md`), 'utf8');
}

// ---------------------------------------------------------------------------
// Criterion A: a kill lands mid-run, Studio comes back, and the card carries the money it spent.
// ---------------------------------------------------------------------------

test('a card killed while it waits for Todd resumes after the restart with the money already spent and ends at its limit', async () => {
  const { dir, repo, cardDir } = openCase({ limit: 0.03, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  const stateDb = join(dir, 'state.db');
  const traceDb = join(dir, 'trace.duckdb');

  // The first Studio: one build call at $0.015, then the card waits for Todd.
  const firstSpending = openSpending({ dir, limit: 0.03, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  let firstBuildCalls = 0;
  const firstWorkflow = buildCardPath({
    dir,
    repo,
    review: fakeReview(),
    agents: {
      build: meteredAgent({ id: 'flow-build', spending: firstSpending, called: () => { firstBuildCalls += 1; } }),
      shipping: stub(PASS),
      remediation: stub('fixed line'),
      retro: stub('retro line'),
      spending: firstSpending,
    },
  });
  const firstStudio = await openMastra({ card: CARD, stateDb, traceDb, workflow: firstWorkflow });
  const firstRun = await firstStudio.getWorkflow(firstWorkflow.id).createRun();
  const waiting = await firstRun.start({ inputData: { card: CARD, kind: 'product' } });

  assert.equal(waiting.status, 'suspended', 'the card waits for Todd, which is where the kill lands');
  assert.equal(firstBuildCalls, 1);
  assert.equal(firstSpending.total, ONE_CALL_USD, 'the first Studio recorded the build call');

  // The kill: Studio shuts down while the card waits. The ledger is left on disk as the kill found it.
  await firstStudio.shutdown();

  // A new Studio over the same state and trace files: new ledger object, new agents, same card folder.
  const secondSpending = openSpending({ dir, limit: 0.03, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  assert.equal(secondSpending.begin(CARD).total, ONE_CALL_USD, 'the restarted Studio reads the money already spent');

  let secondBuildCalls = 0;
  const secondWorkflow = buildCardPath({
    dir,
    repo,
    review: fakeReview(),
    agents: {
      build: meteredAgent({ id: 'flow-build', spending: secondSpending, called: () => { secondBuildCalls += 1; } }),
      shipping: stub(PASS),
      remediation: stub('fixed line'),
      retro: stub('retro line'),
      spending: secondSpending,
    },
  });
  const secondStudio = await openMastra({ card: CARD, stateDb, traceDb, workflow: secondWorkflow });
  const wf = secondStudio.getWorkflow(secondWorkflow.id);
  const resumedRun = await wf.createRun({ runId: firstRun.runId });
  const saved = await wf.getWorkflowRunById(firstRun.runId);
  const open = createWorkflowStateReader(saved).getSuspendedStep();

  // Todd says no to the build, so the card builds again in the restarted Studio. The second build
  // call spends the last of the limit, which ends the card with the reason in the report.
  const result = await resumedRun.resume({
    step: open.stepId,
    resumeData: { request: open.suspendPayload.request, answer: 'no' },
  });
  await secondStudio.shutdown();

  assert.equal(secondBuildCalls, 1, 'the resumed card built once in the restarted Studio');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true, 'the card ends rather than reaching Todd again');
  assert.equal(result.result.finished, true);
  assert.equal(secondSpending.calls.length, 2, 'one call before the kill and one after it');
  assert.equal(secondSpending.total, Number((2 * ONE_CALL_USD).toFixed(12)), 'the total carries the pre-kill spend');
  assert.ok(secondSpending.total > ONE_CALL_USD, 'the restarted card did not start from zero');
  assert.equal(secondSpending.stopReason(), STOP_REASONS.limit);

  const report = readReport(cardDir);
  assert.match(report, /Part: Spending/);
  assert.match(report, /card spending limit reached/);
  assert.ok(secondSpending.total <= 0.03 + ONE_CALL_USD, 'the total stays under the limit plus one call');
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion B: Shipping fails again and again, and the cap ends the card before the second failure.
// ---------------------------------------------------------------------------

test('a card whose Shipping fails again and again ends with "card spending limit reached"', async () => {
  const { dir, repo, cardDir } = openCase({ limit: 0.05, verdicts: { smoke: ['PASS'] } });
  const spending = openSpending({ dir, limit: 0.05, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  let shippingCalls = 0;
  let remediationCalls = 0;
  const workflow = buildCardPath({
    dir,
    repo,
    review: fakeReview(),
    agents: {
      build: meteredAgent({ id: 'flow-build', spending }),
      shipping: meteredAgent({
        id: 'flow-shipping',
        spending,
        called: () => { shippingCalls += 1; },
        modelOptions: { text: FAIL },
      }),
      remediation: meteredAgent({ id: 'flow-remediation', spending, called: () => { remediationCalls += 1; } }),
      retro: stub('retro line'),
      spending,
    },
  });
  const studio = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const run = await studio.getWorkflow(workflow.id).createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'product' } });
  await studio.shutdown();

  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(shippingCalls, 2, 'Shipping reviewed the card twice, and both reviews failed it');
  assert.equal(remediationCalls, 1, 'the first failure was handed to remediation');
  assert.equal(spending.calls.length, 4, 'build, shipping, remediation, shipping');
  assert.equal(spending.stopReason(), STOP_REASONS.limit, 'the cap ended the card, not the second failure');

  const report = readReport(cardDir);
  assert.match(report, /Part: Spending/);
  assert.match(report, /card spending limit reached/);
  assert.match(report, /Failures counted: 1/);
  assert.match(report, /Shipping rounds: 1/);
  assert.doesNotMatch(report, /Shipping failed twice/, 'the card never reached its second counted failure');

  // Only the first FAIL was counted. The card ran out of money in the round that would have read
  // the second verdict, so the second FAIL never reached the record.
  const cursors = JSON.parse(readFileSync(join(cardDir, 'cursors.json'), 'utf8'));
  assert.equal(cursors.review, undefined, 'the review round that ran out of money read no verdict');
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion C: a lead starts 150 helpers at once, and the total equals every answered call.
// ---------------------------------------------------------------------------

test('a lead that starts 150 helpers at once ends at its limit, and the total equals every call the fake model answered', async () => {
  const { dir, repo, cardDir } = openCase({ limit: 0.04, verdicts: { smoke: ['PASS'] } });
  const limit = 0.04;
  const spending = openSpending({ dir, limit, catalog: CATALOG, corrections: {}, now: OFF_PEAK });

  const helperCount = 150;
  let helperCalls = 0;
  let running = 0;
  let mostAtOnce = 0;
  const helperStarted = () => {
    helperCalls += 1;
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
  };
  const helpers = Object.fromEntries(Array.from({ length: helperCount }, (_, index) => {
    const key = `pstackBugFix${index + 1}`;
    return [key, meteredAgent({
      id: `pstack-bug-fix-${index + 1}`,
      name: `Bug fix ${index + 1}`,
      description: 'Does one task delegated by the Lead.',
      spending,
      modelOptions: { called: helperStarted, done: () => { running -= 1; }, delayMs: 5 },
    })];
  }));

  let leadCalls = 0;
  const lead = meteredAgent({
    id: 'flow-build',
    spending,
    processorOptions: { refuseAfterStop: true },
    modelOptions: {
      called: () => { leadCalls += 1; },
      text: 'helpers are on it',
      // The first answer starts every helper at once, which is the swarm the cap has to survive.
      toolCalls: () => (leadCalls === 1
        ? Object.keys(helpers).map(key => ({ name: `agent-${key}`, input: { prompt: 'do the next piece' } }))
        : null),
    },
    agents: helpers,
    defaultOptions: {
      maxSteps: 10,
      toolCallConcurrency: HELPER_CONCURRENCY,
      hooks: helperStartHook(spending),
    },
  });

  const workflow = buildCardPath({
    dir,
    repo,
    review: fakeReview(),
    agents: { build: lead, shipping: stub(PASS), remediation: stub('fixed line'), retro: stub('retro line'), spending },
  });
  const studio = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const run = await studio.getWorkflow(workflow.id).createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'product' } });
  await studio.shutdown();

  const answered = leadCalls + helperCalls;
  assert.ok(helperCalls < helperCount, 'the cap turned away the helpers the card could no longer afford');
  assert.ok(mostAtOnce <= HELPER_CONCURRENCY, 'a fixed number of helpers runs at once');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(spending.stopReason(), STOP_REASONS.limit);

  // The total is what the provider would bill: every call that finished, including the helpers that
  // were already running when the cap was crossed.
  assert.equal(spending.calls.length, answered, 'the ledger counts every call the model answered');
  assert.equal(spending.total, Number((answered * ONE_CALL_USD).toFixed(12)), 'each answered call added its dollars');

  // The bound: the cap is crossed once, and only the helpers allowed to run at once can finish after
  // it, so the total cannot pass the limit plus one call per helper running at that moment.
  assert.ok(
    spending.total <= limit + HELPER_CONCURRENCY * ONE_CALL_USD,
    `the total ${spending.total} fits the limit ${limit} plus ${HELPER_CONCURRENCY} calls`,
  );

  const report = readReport(cardDir);
  assert.match(report, /Part: Spending/);
  assert.match(report, /card spending limit reached/);
  assert.match(
    report,
    new RegExp(`Worst overshoot: \\$${(HELPER_CONCURRENCY * ONE_CALL_USD).toFixed(3)} \\(${HELPER_CONCURRENCY} helpers`),
    'the report states the worst overshoot the fixed number allows',
  );
  rmSync(dir, { recursive: true, force: true });
});
