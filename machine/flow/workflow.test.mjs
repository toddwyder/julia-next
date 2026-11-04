// The flow's outcomes, driven through the real workflow with stand-in agents,
// so the order, the shared failure count, the wait and the stop are the
// workflow's own settings rather than a stub of them.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { initialState } = await import('./schema.mjs');
const { openScratch } = await import('./scratch.mjs');
const { createWorkflowStateReader } = await import('@mastra/core/workflows');

const CARD = 'JUL-336-STANDIN';
const stub = text => ({ generate: async () => ({ text }) });
const agents = {
  build: stub('built line'),
  shipping: stub('looked'),
  remediation: stub('fixed line'),
  retro: stub('retro line'),
};

async function openCase({ kind = 'product', review = ['PASS'], smoke = ['PASS'], answers = ['yes'] }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-case-'));
  mkdirSync(dir, { recursive: true });
  openScratch(dir);
  writeFileSync(join(dir, 'verdicts.json'), JSON.stringify({ review, smoke }));
  writeFileSync(join(dir, 'cursors.json'), '{}');

  const workflow = buildCardPath({ agents, dir });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const trail = [];
  let result = await run.start({
    inputData: { card: CARD, kind },
    initialState: initialState(CARD, kind),
  });

  while (result.status === 'suspended') {
    const state = await wf.getWorkflowRunById(run.runId);
    const open = createWorkflowStateReader(state).getSuspendedStep();
    trail.push({ path: open.path, request: open.suspendPayload.request });
    const answer = answers.shift() ?? 'yes';
    result = await run.resume({
      step: open.stepId,
      resumeData: { request: open.suspendPayload.request, answer },
    });
    assert.ok(trail.length < 8, 'the run should not need more than a few answers');
  }

  const report = join(dir, 'reports', `${CARD}.md`);
  return { result, trail, dir, report, workflow };
}

test('a passing card waits for Todd two levels deep, then lands, retros and cleans up', async () => {
  const { result, trail, dir, report } = await openCase({});

  assert.equal(trail.length, 1);
  assert.deepEqual(trail[0].path, ['attempt', 'acceptance']);
  assert.equal(trail[0].request, `${CARD}/build-1`);
  assert.equal(result.status, 'success');
  assert.equal(result.result.accepted, true);
  assert.equal(result.result.landed, true);
  assert.equal(result.result.finished, true);
  assert.equal(existsSync(join(dir, 'retro', `${CARD}.md`)), true);
  assert.equal(existsSync(join(dir, 'build')), false, 'cleanup sweeps the build folder');
  assert.equal(existsSync(report), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a Shipping FAIL goes to remediation and a fresh Shipping pass lands the card', async () => {
  const { result, dir, report } = await openCase({ review: ['FAIL', 'PASS'] });

  assert.equal(result.status, 'success');
  assert.equal(result.result.failCount, 1);
  assert.equal(result.result.verdict, 'PASS');
  assert.equal(result.result.landed, true);
  assert.equal(existsSync(report), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a second Shipping FAIL stops the card with a report and asks nobody', async () => {
  const { result, trail, dir, report } = await openCase({ review: ['FAIL', 'FAIL'] });

  assert.equal(trail.length, 0, 'a stopped card never reaches Todd');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(result.result.failCount, 2);
  assert.equal(result.result.landed, false);
  const text = readFileSync(report, 'utf8');
  assert.match(text, /Part: Shipping/);
  assert.match(text, /Failures counted: 2/);
  rmSync(dir, { recursive: true, force: true });
});

test('a live smoke FAIL after landing goes to a fresh Shipping pass and straight back to land', async () => {
  const { result, trail, dir, report } = await openCase({ smoke: ['FAIL', 'PASS'] });

  assert.equal(trail.length, 1, 'the fix after a smoke failure does not ask Todd again');
  assert.equal(result.status, 'success');
  assert.equal(result.result.failCount, 1);
  assert.equal(result.result.landed, true);
  assert.equal(result.result.stopped, false);
  assert.equal(existsSync(report), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a second live smoke FAIL stops the card and says which part failed', async () => {
  const { result, dir, report } = await openCase({ smoke: ['FAIL', 'FAIL'] });

  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(result.result.failCount, 2);
  const text = readFileSync(report, 'utf8');
  assert.match(text, /Part: live smoke test/);
  rmSync(dir, { recursive: true, force: true });
});

test("Todd's no sends the card back to build and a later yes lands it", async () => {
  const { result, trail, dir } = await openCase({ answers: ['no', 'yes'] });

  assert.deepEqual(
    trail.map(entry => entry.request),
    [`${CARD}/build-1`, `${CARD}/build-2`],
  );
  assert.equal(result.status, 'success');
  assert.equal(result.result.accepted, true);
  assert.equal(result.result.landed, true);
  rmSync(dir, { recursive: true, force: true });
});

test('a machine card walks the same path without asking Todd', async () => {
  const { result, trail, dir } = await openCase({ kind: 'machine' });

  assert.equal(trail.length, 0);
  assert.equal(result.status, 'success');
  assert.equal(result.result.accepted, true);
  assert.equal(result.result.landed, true);
  rmSync(dir, { recursive: true, force: true });
});

test('an answer for another request is refused and the same run still takes the right one', async () => {
  const dirCase = mkdtempSync(join(tmpdir(), 'flow-stale-'));
  openScratch(dirCase);
  writeFileSync(join(dirCase, 'verdicts.json'), JSON.stringify({ review: ['PASS'], smoke: ['PASS'] }));
  writeFileSync(join(dirCase, 'cursors.json'), '{}');
  const caseWorkflow = buildCardPath({ agents, dir: dirCase });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dirCase, 'state.db'),
    traceDb: join(dirCase, 'trace.duckdb'),
    workflow: caseWorkflow,
  });
  const w = mastra.getWorkflow(caseWorkflow.id);
  const run = await w.createRun();
  const started = await run.start({
    inputData: { card: CARD, kind: 'product' },
    initialState: initialState(CARD, 'product'),
  });
  assert.equal(started.status, 'suspended');

  const wrong = await run.resume({
    step: 'attempt',
    resumeData: { request: `${CARD}/build-9`, answer: 'yes' },
  });
  assert.equal(wrong.status, 'suspended', 'an answer to another request keeps the card waiting');
  const stillOpen = createWorkflowStateReader(await w.getWorkflowRunById(run.runId)).getSuspendedStep();
  assert.equal(stillOpen.suspendPayload.request, `${CARD}/build-1`);

  const right = await run.resume({
    step: 'attempt',
    resumeData: { request: `${CARD}/build-1`, answer: 'yes' },
  });
  assert.equal(right.status, 'success');
  assert.equal(right.result.landed, true);

  rmSync(dirCase, { recursive: true, force: true });
});
