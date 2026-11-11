// The flow's outcomes, driven through the real workflow with real agent steps
// on a mock model, so the order, the shared failure count, the wait and the
// stop are the workflow's own settings rather than a stub of them. The run is
// started the way Studio's run button starts one: a card and its kind, and no
// saved state.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createMockModel } = await import('@mastra/core/test-utils/llm-mock');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { BUILD_RETRIES } = await import('./steps.mjs');
const { openScratch } = await import('./scratch.mjs');
const { createWorkflowStateReader } = await import('@mastra/core/workflows');

const CARD = 'JUL-336-STANDIN';

const buildOn = model =>
  new Agent({ id: 'flow-build', name: 'Flow build', instructions: 'Reply with one line.', model });

// The Codex route answers only a streamed request, so a stage agent that is asked to generate fails the way
// it does there: HTTP 400 "Stream must be set to true".
const stub = text => ({
  generate: async () => { throw new Error('Bad Request: Stream must be set to true'); },
  stream: async () => ({ text: Promise.resolve(text) }),
});
const agents = {
  build: buildOn(createMockModel({ mockText: 'built line' })),
  remediation: stub('fixed line'),
  retro: stub('retro line'),
};

const answerFor = verdict => (verdict.startsWith('text:') ? verdict.slice(5) : `VERDICT: ${verdict}\nCRITERION 1: ${verdict} — ran the command\nNOTES: none`);

// The Shipping stage's outside world, scripted: which pull request the card has, the card's text, the
// checkout, the comment post. The agent answers from the queue and the verdict comes from its text.
function fakeReview(queue, { pulls = { pr: 498 }, postFails = false } = {}) {
  const posted = [];
  const asked = [];
  const shipping = {
    stream: async (task, options) => {
      asked.push({ task, checkout: options.requestContext?.get?.('shippingCheckout') });
      const next = queue.shift() ?? 'PASS';
      return { text: Promise.resolve(answerFor(next)) };
    },
  };
  const review = {
    findPr: () => pulls,
    readCard: async identifier => ({ identifier, title: 'A card', description: '## Acceptance criteria\n- it works' }),
    prepareCheckout: () => 'abc123',
    removeCheckout: () => {},
    postPrComment: (repo, pr, body) => {
      if (postFails) throw new Error('gh: not signed in');
      posted.push({ pr, body });
    },
  };
  return { shipping, review, posted, asked };
}

async function openCase({
  kind = 'product',
  review: queue = ['PASS'],
  reviewOptions,
  smoke = ['PASS'],
  answers = ['yes'],
  build,
  untilFirstWait = false,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-case-'));
  mkdirSync(dir, { recursive: true });
  openScratch(dir);
  const caseDir = join(dir, CARD);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');

  const fake = fakeReview([...queue], reviewOptions);
  const workflow = buildCardPath({
    agents: { ...agents, ...(build ? { build } : {}), shipping: fake.shipping },
    dir,
    repo: '/repo',
    review: fake.review,
  });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const trail = [];
  let result = await run.start({ inputData: { card: CARD, kind } });

  while (result.status === 'suspended') {
    const state = await wf.getWorkflowRunById(run.runId);
    const open = createWorkflowStateReader(state).getSuspendedStep();
    trail.push({ path: open.path, request: open.suspendPayload.request });
    if (untilFirstWait) break;
    const answer = answers.shift() ?? 'yes';
    result = await run.resume({
      step: open.stepId,
      resumeData: { request: open.suspendPayload.request, answer },
    });
    assert.ok(trail.length < 8, 'the run should not need more than a few answers');
  }

  const report = join(caseDir, 'reports', `${CARD}.md`);
  return { result, trail, dir, caseDir, report, workflow, fake };
}

test('a passing card waits for Todd two levels deep, then lands, retros and cleans up', async () => {
  const { result, trail, dir, caseDir, report } = await openCase({});

  assert.equal(trail.length, 1);
  assert.deepEqual(trail[0].path, ['attempt', 'acceptance']);
  assert.equal(trail[0].request, `${CARD}/build-1`);
  assert.equal(result.status, 'success');
  assert.equal(result.result.accepted, true);
  assert.equal(result.result.landed, true);
  assert.equal(result.result.finished, true);
  assert.equal(existsSync(join(caseDir, 'retro', `${CARD}.md`)), true);
  assert.equal(existsSync(join(caseDir, 'build')), false, 'cleanup sweeps the build folder');
  assert.equal(existsSync(report), false);
  rmSync(dir, { recursive: true, force: true });
});

test('the build stage runs a real agent step and keeps what the agent wrote', async () => {
  const asked = [];
  const build = buildOn(
    createMockModel({ mockText: 'built line', spyStream: props => asked.push(props) }),
  );
  const { trail, dir, caseDir } = await openCase({ build, untilFirstWait: true });

  assert.equal(trail.length, 1, 'the card reaches Todd, so the build finished before the wait');
  assert.equal(asked.length, 1, 'the build stage makes one model call');
  assert.match(JSON.stringify(asked[0]), new RegExp(CARD), 'the model is asked about this card');
  assert.match(readFileSync(join(caseDir, 'build', `${CARD}.md`), 'utf8'), /built line/);
  rmSync(dir, { recursive: true, force: true });
});

test('a model failure in the build step gets exactly the attempts its retry setting names', async () => {
  let attempts = 0;
  const failing = buildOn(
    createMockModel({
      spyStream: () => {
        attempts += 1;
        throw new Error('the model is down');
      },
    }),
  );
  const { result, dir } = await openCase({ build: failing });

  assert.equal(result.status, 'failed');
  assert.equal(attempts, BUILD_RETRIES + 1, 'the step retries its own setting, no more and no less');
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

test('Shipping gets the card and its pull request, and the verdict is posted on that pull request by the stage', async () => {
  const { result, dir, fake } = await openCase({ kind: 'machine' });

  assert.equal(result.status, 'success');
  assert.equal(fake.asked.length, 1);
  assert.match(fake.asked[0].task, /pull request #498/);
  assert.match(fake.asked[0].task, /it works/);
  assert.doesNotMatch(fake.asked[0].task, /built line/, 'the builder\'s words never reach Shipping');
  assert.match(fake.asked[0].checkout, /review$/);
  assert.equal(fake.posted.length, 1);
  assert.equal(fake.posted[0].pr, 498);
  assert.match(fake.posted[0].body, /^Shipping agent: PASS\n/);
  rmSync(dir, { recursive: true, force: true });
});

test('PASS+NOTES moves the card forward like PASS and its notes are on the pull request', async () => {
  const { result, dir, fake } = await openCase({ kind: 'machine', review: ['PASS+NOTES'] });

  assert.equal(result.status, 'success');
  assert.equal(result.result.verdict, 'PASS+NOTES');
  assert.equal(result.result.failCount, 0);
  assert.equal(result.result.landed, true);
  assert.match(fake.posted[0].body, /^Shipping agent: PASS\+NOTES\n/);
  rmSync(dir, { recursive: true, force: true });
});

for (const [name, options, why] of [
  ['an answer with no verdict line', { review: ['text:I looked around and it seemed fine.'] }, /first line is not a verdict line/],
  ['a verdict line with two verdict words', { review: ['text:VERDICT: PASS | FAIL\nCRITERION 1: PASS — ok'] }, /exactly one of PASS/],
  ['a PASS with a FAIL criterion line', { review: ['text:VERDICT: PASS\nCRITERION 1: FAIL — broke'] }, /PASS with a FAIL criterion line/],
  ['a PASS+NOTES with a FAIL criterion line', { review: ['text:VERDICT: PASS+NOTES\nCRITERION 1: FAIL — broke'] }, /PASS\+NOTES with a FAIL criterion line/],
  ['an answer missing a criterion line', { review: ['text:VERDICT: PASS\nNOTES: none'] }, /criterion 1 does not have exactly one/],
  ['an answer with a criterion line twice', { review: ['text:VERDICT: PASS\nCRITERION 1: PASS — a\nCRITERION 1: PASS — b'] }, /criterion 1 does not have exactly one/],
  ['a verdict line that is not first', { review: ['text:I checked.\nVERDICT: PASS\nCRITERION 1: PASS — ok'] }, /first line is not a verdict line/],
  ['no pull request for the card', { reviewOptions: { pulls: { reason: 'no open pull request names the card' } } }, /no open pull request names the card/],
  ['a verdict that could not be posted', { reviewOptions: { postFails: true } }, /could not be posted to pull request #498/],
]) {
  test(`${name} leaves the failure count alone and reports the card as unreviewed`, async () => {
    const { result, trail, dir, report } = await openCase({ kind: 'machine', ...options });

    assert.equal(trail.length, 0);
    assert.equal(result.status, 'success');
    assert.equal(result.result.stopped, true);
    assert.equal(result.result.landed, false);
    assert.equal(result.result.failCount, 0);
    const text = readFileSync(report, 'utf8');
    assert.match(text, /Part: Shipping/);
    assert.match(text, why);
    assert.match(text, /unreviewed/);
    assert.match(text, /Failures counted: 0/);
    rmSync(dir, { recursive: true, force: true });
  });
}

test('parseVerdict reads a well-formed answer and refuses each malformed one', async () => {
  const { parseVerdict } = await import('./review.mjs');
  assert.equal(parseVerdict('\n\nVERDICT: PASS\nCRITERION 1: PASS — ok\nCRITERION 2: PASS — ok', 2).verdict, 'PASS');
  assert.equal(parseVerdict('VERDICT: FAIL\nCRITERION 1: PASS — ok\nCRITERION 2: FAIL — no', 2).verdict, 'FAIL');
  assert.equal(parseVerdict('VERDICT: PASS\nCRITERION 1: PASS — ok', 2).verdict, null);
  assert.equal(parseVerdict('VERDICT: PASS\nCRITERION 1: PASS — ok\nCRITERION 2: PASS — ok', 1).verdict, null);
  assert.equal(parseVerdict('VERDICT: PASS FAIL\nCRITERION 1: PASS — ok', 1).verdict, null);
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
  const caseDir = join(dirCase, CARD);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');
  const fake = fakeReview(['PASS']);
  const caseWorkflow = buildCardPath({ agents: { ...agents, shipping: fake.shipping }, dir: dirCase, repo: '/repo', review: fake.review });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dirCase, 'state.db'),
    traceDb: join(dirCase, 'trace.duckdb'),
    workflow: caseWorkflow,
  });
  const w = mastra.getWorkflow(caseWorkflow.id);
  const run = await w.createRun();
  const started = await run.start({ inputData: { card: CARD, kind: 'product' } });
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
