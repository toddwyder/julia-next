// The three proofs Todd asked for after the cap shipped: a card killed while Studio waits for him,
// a card whose Shipping keeps failing, and a lead that starts 150 helpers at once. Every call here
// is a fake AI SDK model, so the dollars in each assertion are exact.

import assert from 'node:assert/strict';
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
const { STOP_REASONS, openSpending, spendingProcessor } = await import('./spending.mjs');

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

function fakeModel({ usage, text = 'one line', called = () => {} }) {
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

// A real agent on the fake model, counted by the ledger. `ids` is fixed the way the picker fixes it.
function meteredAgent({ id, spending, called = () => {}, usage }) {
  const guard = spendingProcessor(spending, () => ({ provider: 'commandcode', model: DEEPSEEK }));
  return new Agent({
    id,
    name: id,
    instructions: 'Reply with one line.',
    model: fakeModel({ usage, called }),
    inputProcessors: [guard],
    outputProcessors: [guard],
  });
}

// A stand-in stage that answers without calling a model, so only the calls under test cost money.
const stub = text => ({ generate: async () => ({ text }), stream: async () => ({ text: Promise.resolve(text) }) });

function openCase({ limit, verdicts }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-proofs-'));
  const cardDir = join(dir, CARD);
  mkdirSync(cardDir, { recursive: true });
  writeFileSync(join(cardDir, 'verdicts.json'), JSON.stringify(verdicts));
  writeFileSync(join(cardDir, 'cursors.json'), '{}');
  openScratch(dir);
  return { dir, cardDir };
}

function readReport(cardDir) {
  return readFileSync(join(cardDir, 'reports', `${CARD}.md`), 'utf8');
}

// ---------------------------------------------------------------------------
// Criterion A: a kill lands mid-run, Studio comes back, and the card carries the money it spent.
// ---------------------------------------------------------------------------

test('a card killed while it waits for Todd resumes after the restart with the money already spent and ends at its limit', async () => {
  const { dir, cardDir } = openCase({ limit: 0.03, verdicts: { review: ['PASS'], smoke: ['PASS'] } });
  const stateDb = join(dir, 'state.db');
  const traceDb = join(dir, 'trace.duckdb');

  // The first Studio: one build call at $0.015, then the card waits for Todd.
  const firstSpending = openSpending({ dir, limit: 0.03, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  let firstBuildCalls = 0;
  const firstWorkflow = buildCardPath({
    dir,
    agents: {
      build: meteredAgent({ id: 'flow-build', spending: firstSpending, called: () => { firstBuildCalls += 1; } }),
      shipping: stub('looked'),
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
    agents: {
      build: meteredAgent({ id: 'flow-build', spending: secondSpending, called: () => { secondBuildCalls += 1; } }),
      shipping: stub('looked'),
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
  const { dir, cardDir } = openCase({ limit: 0.05, verdicts: { review: ['FAIL', 'FAIL', 'FAIL'], smoke: ['PASS'] } });
  const spending = openSpending({ dir, limit: 0.05, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  let shippingCalls = 0;
  let remediationCalls = 0;
  const workflow = buildCardPath({
    dir,
    agents: {
      build: meteredAgent({ id: 'flow-build', spending }),
      shipping: meteredAgent({ id: 'flow-shipping', spending, called: () => { shippingCalls += 1; } }),
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
  assert.equal(shippingCalls, 2, 'Shipping got two rounds, both queued to fail');
  assert.equal(remediationCalls, 1, 'the first failure was handed to remediation');
  assert.equal(spending.calls.length, 4, 'build, shipping, remediation, shipping');
  assert.equal(spending.stopReason(), STOP_REASONS.limit, 'the cap ended the card, not the second failure');

  const report = readReport(cardDir);
  assert.match(report, /Part: Spending/);
  assert.match(report, /card spending limit reached/);
  assert.match(report, /Failures counted: 1/);
  assert.match(report, /Shipping rounds: 1/);
  assert.doesNotMatch(report, /Shipping failed twice/, 'the card never reached its second counted failure');

  // Only the first FAIL was read. The card ran out of money in the round that would have read the
  // second one, so the queue Todd set is still waiting.
  const cursors = JSON.parse(readFileSync(join(cardDir, 'cursors.json'), 'utf8'));
  assert.equal(cursors.review, 1);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Criterion C: a lead starts 150 helpers at once, and the total stops at the cap.
// ---------------------------------------------------------------------------

test('a lead that starts 150 helpers at once ends at its limit, and the total stays within one call per running helper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-proofs-swarm-'));
  const limit = 0.04;
  const spending = openSpending({ dir, limit, catalog: CATALOG, corrections: {}, now: OFF_PEAK });
  spending.begin(CARD);

  let leadCalls = 0;
  const lead = meteredAgent({ id: 'flow-build', spending, called: () => { leadCalls += 1; } });
  await lead.generate('start the work');
  assert.equal(leadCalls, 1);
  assert.equal(spending.total, ONE_CALL_USD, 'the lead paid for its own call first');

  const helperCount = 150;
  let helperCalls = 0;
  const helpers = Array.from({ length: helperCount }, (_, index) =>
    meteredAgent({
      id: `pstack-bug-fix-${index + 1}`,
      spending,
      called: () => { helperCalls += 1; },
    }),
  );

  // Every helper is in flight at the same moment, which is the case the cap has to survive.
  await Promise.allSettled(helpers.map(helper => helper.generate('do the next piece')));

  assert.equal(helperCalls, helperCount, 'every helper did reach its model, as a real swarm would');
  assert.equal(spending.stopReason(), STOP_REASONS.limit);
  assert.equal(spending.calls.length, 3, 'the lead and two helpers are the calls the ledger counted');
  assert.equal(spending.total, Number((3 * ONE_CALL_USD).toFixed(12)), 'the ledger stops adding at the crossing call');

  // The criterion's bound: the total cannot pass the limit plus one call per helper that was still
  // running when the limit was crossed. The helpers whose money was counted are the two after the
  // lead, so 148 were still running at that moment.
  const helpersCounted = spending.calls.length - 1;
  const runningWhenCrossed = helperCount - helpersCounted;
  assert.ok(
    spending.total <= limit + runningWhenCrossed * ONE_CALL_USD,
    `the total ${spending.total} fits the limit ${limit} plus ${runningWhenCrossed} running helpers`,
  );
  assert.equal(spending.blockingReason({ provider: 'commandcode', model: DEEPSEEK }), STOP_REASONS.limit);
  rmSync(dir, { recursive: true, force: true });
});
