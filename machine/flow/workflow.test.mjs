// The flow's outcomes, driven through the real workflow with real agent steps
// on a mock model, so the order, the shared failure count, the wait and the
// stop are the workflow's own settings rather than a stub of them. The run is
// started the way Studio's run button starts one: a card and its kind, and no
// saved state.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createMockModel } = await import('@mastra/core/test-utils/llm-mock');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');
const { copiesRoot } = await import('./copy.mjs');
const { createWorkflowStateReader } = await import('@mastra/core/workflows');
const { LocalFilesystem, LocalSandbox, Workspace } = await import('@mastra/core/workspace');

const CARD = 'JUL-336-STANDIN';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function studioRepo(dir) {
  const repo = join(dir, 'studio');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=flow@test', '-c', 'user.name=flow', 'commit', '--quiet', '-m', 'main']);
  return repo;
}

const contents = repo => readdirSync(repo, { recursive: true })
  .filter(entry => !String(entry).startsWith('.git'))
  .sort();

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

function fakeReview(queue, { pulls = { pr: 498 }, postFails = false } = {}) {
  const posted = [];
  const asked = [];
  const shipping = {
    stream: async (task, options) => {
      asked.push({ task, checkout: options.requestContext?.get?.('cardCheckout') });
      const next = queue.shift() ?? 'PASS';
      return { text: Promise.resolve(answerFor(next)) };
    },
  };
  const review = {
    findPr: () => pulls,
    readCard: async identifier => ({ identifier, title: 'A card', description: '## Acceptance criteria\n- it works' }),
    headCommit: () => 'abc123',
    postPrComment: (repo, pr, body) => {
      if (postFails) throw new Error('gh: not signed in');
      posted.push({ pr, body });
    },
  };
  return { shipping, review, posted, asked };
}

async function openCase({
  card = CARD,
  kind = 'product',
  dir: givenDir,
  repo: givenRepo,
  review: queue = ['PASS'],
  reviewOptions,
  smoke = ['PASS'],
  answers = ['yes'],
  build,
  untilFirstWait = false,
}) {
  const dir = givenDir ?? mkdtempSync(join(tmpdir(), 'flow-case-'));
  mkdirSync(dir, { recursive: true });
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  const repo = givenRepo ?? studioRepo(dir);
  openScratch(dir);
  const caseDir = join(dir, card);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');

  const fake = fakeReview([...queue], reviewOptions);
  const workflow = buildCardPath({
    agents: { ...agents, ...(build ? { build } : {}), shipping: fake.shipping },
    dir,
    repo,
    review: fake.review,
  });
  const mastra = await openMastra({
    card,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const trail = [];
  let result = await run.start({ inputData: { card, kind } });

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

  const report = join(caseDir, 'reports', `${card}.md`);
  return { result, trail, dir, caseDir, report, workflow, fake, repo, card, run, wf, mastra };
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
  assert.equal(existsSync(report), true, 'cleanup leaves the card report behind');
  assert.match(readFileSync(report, 'utf8'), /## Tokens read/);
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

test('a model failure in the build step fails the card without a retry setting of its own', async () => {
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
  assert.equal(attempts, 1, 'the step carries no retry setting, so it makes one attempt');
  rmSync(dir, { recursive: true, force: true });
});

const buildInCopy = (log, note) =>
  new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: 'Reply with one line.',
    model: createMockModel({ mockText: 'built line' }),
    workspace: ({ requestContext } = {}) => {
      const folder = requestContext?.get?.('cardCheckout') ?? join(tmpdir(), 'no-card-copy');
      const entry = {
        folder,
        sawMain: existsSync(join(folder, 'README.md')),
        sawEarlierRound: existsSync(join(folder, 'round-1.txt')),
      };
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, note), 'written by the build\n');
      entry.wrote = existsSync(join(folder, note));
      log.push(entry);
      return new Workspace({
        id: `card-copy-${log.length}`,
        filesystem: new LocalFilesystem({ basePath: folder }),
        sandbox: new LocalSandbox({ workingDirectory: folder }),
      });
    },
  });

test("a card builds in a fresh copy named after it, and the copy goes when the card ends", async () => {
  const log = [];
  const { result, dir, repo } = await openCase({ build: buildInCopy(log, 'build-note.txt') });
  const folder = join(copiesRoot(), CARD);

  assert.ok(log.length > 0);
  assert.equal(log[0].folder, folder, 'the build works in the folder named after the card');
  assert.equal(log[0].sawMain, true, 'the copy starts from main, so main has a file in it');
  assert.equal(log[0].wrote, true);
  assert.equal(result.status, 'success');
  assert.equal(existsSync(folder), false, 'the copy is removed when the card ends');
  assert.notEqual(git(repo, ['branch', '--list', `card/${CARD}`]).trim(), '', 'the branch and its pull request stay');
  rmSync(dir, { recursive: true, force: true });
});

test('two cards started together each work in their own copy and leave the Studio folder alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-two-'));
  const repo = studioRepo(dir);
  const before = contents(repo);
  const log = [];

  const [one, two] = await Promise.all([
    openCase({ card: 'JUL-100-ONE', dir, repo, build: buildInCopy(log, 'one.txt') }),
    openCase({ card: 'JUL-101-TWO', dir, repo, build: buildInCopy(log, 'two.txt') }),
  ]);

  const folders = [...new Set(log.map(entry => entry.folder))].sort();
  assert.deepEqual(folders, [join(copiesRoot(), 'JUL-100-ONE'), join(copiesRoot(), 'JUL-101-TWO')].sort());
  assert.equal(one.result.status, 'success');
  assert.equal(two.result.status, 'success');
  assert.deepEqual(contents(repo), before, 'the Studio folder is exactly as it was');
  assert.equal(git(repo, ['status', '--porcelain']), '', 'the Studio repository has no stray work in it');
  assert.equal(git(repo, ['worktree', 'list']).trim().split('\n').length, 1, 'only the Studio folder is left as a worktree');
  rmSync(dir, { recursive: true, force: true });
});

test('a card resumed after a restart carries on in the same copy', async () => {
  const log = [];
  const build = buildInCopy(log, 'round-2.txt');
  const { dir, repo, workflow, fake, run, mastra } = await openCase({ build, untilFirstWait: true, answers: ['no'] });
  const folder = join(copiesRoot(), CARD);
  assert.equal(log[0].folder, folder);
  writeFileSync(join(folder, 'round-1.txt'), 'round one\n');

  await mastra.shutdown();
  const restarted = buildCardPath({
    agents: { ...agents, build, shipping: fake.shipping },
    dir,
    repo,
    review: fake.review,
  });
  assert.equal(restarted.id, workflow.id);
  const back = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow: restarted,
  });
  const wf = back.getWorkflow(restarted.id);
  const resumed = await wf.createRun({ runId: run.runId });
  const open = createWorkflowStateReader(await wf.getWorkflowRunById(run.runId)).getSuspendedStep();
  let result = await resumed.resume({
    step: open.stepId,
    resumeData: { request: open.suspendPayload.request, answer: 'no' },
  });
  while (result.status === 'suspended') {
    const state = await wf.getWorkflowRunById(run.runId);
    const wait = createWorkflowStateReader(state).getSuspendedStep();
    result = await resumed.resume({
      step: wait.stepId,
      resumeData: { request: wait.suspendPayload.request, answer: 'yes' },
    });
  }
  await back.shutdown();

  assert.equal(log[log.length - 1].folder, folder, 'the second build round works in the same copy');
  assert.equal(log[log.length - 1].sawEarlierRound, true, 'the copy kept what the first round wrote');
  assert.equal(result.status, 'success');
  rmSync(dir, { recursive: true, force: true });
});

test('a Shipping FAIL goes to remediation and a fresh Shipping pass lands the card', async () => {
  const { result, dir, report } = await openCase({ review: ['FAIL', 'PASS'] });

  assert.equal(result.status, 'success');
  assert.equal(result.result.failCount, 1);
  assert.equal(result.result.verdict, 'PASS');
  assert.equal(result.result.landed, true);
  assert.equal(existsSync(report), true, 'cleanup leaves the card report behind');
  rmSync(dir, { recursive: true, force: true });
});

test('Shipping gets the card and its pull request, and the verdict is posted on that pull request by the stage', async () => {
  const { result, dir, fake } = await openCase({ kind: 'machine' });

  assert.equal(result.status, 'success');
  assert.equal(fake.asked.length, 1);
  assert.match(fake.asked[0].task, /pull request #498/);
  assert.match(fake.asked[0].task, /it works/);
  assert.doesNotMatch(fake.asked[0].task, /built line/, 'the builder\'s words never reach Shipping');
  assert.equal(fake.asked[0].checkout, join(copiesRoot(), CARD), 'Shipping reviews the copy this card built in');
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

test('a second Shipping FAIL stops the card with a report that names its folder and starting point', async () => {
  const { result, trail, dir, repo } = await openCase({ review: ['FAIL', 'FAIL'] });

  assert.equal(trail.length, 0, 'a stopped card never reaches Todd');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(result.result.failCount, 2);
  assert.equal(result.result.landed, false);
  const text = readFileSync(join(dir, CARD, 'reports', `${CARD}.md`), 'utf8');
  assert.match(text, /Part: Shipping/);
  assert.match(text, /Failures counted: 2/);
  assert.match(text, new RegExp(`Copy: ${join(copiesRoot(), CARD).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(text, new RegExp(`Started from main at: ${git(repo, ['rev-parse', 'HEAD']).trim()}`));
  rmSync(dir, { recursive: true, force: true });
});

test('a live smoke FAIL after landing goes to a fresh Shipping pass and straight back to land', async () => {
  const { result, trail, dir, report } = await openCase({ smoke: ['FAIL', 'PASS'] });

  assert.equal(trail.length, 1, 'the fix after a smoke failure does not ask Todd again');
  assert.equal(result.status, 'success');
  assert.equal(result.result.failCount, 1);
  assert.equal(result.result.landed, true);
  assert.equal(result.result.stopped, false);
  assert.equal(existsSync(report), true, 'cleanup leaves the card report behind');
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
  process.env.FLOW_SCRATCH = join(dirCase, 'scratch');
  const repo = studioRepo(dirCase);
  openScratch(dirCase);
  const caseDir = join(dirCase, CARD);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');
  const fake = fakeReview(['PASS']);
  const caseWorkflow = buildCardPath({ agents: { ...agents, shipping: fake.shipping }, dir: dirCase, repo, review: fake.review });
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
