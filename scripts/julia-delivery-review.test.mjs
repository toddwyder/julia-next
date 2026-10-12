// Public normal dispatch/recording seam. Every response is a local fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDelivery as deliver } from './julia-delivery-runner.mjs';
import { saveJson, loadText } from './julia-delivery-state.mjs';
import { fixtureInput, fixtureReport } from './fixtures/jul202-review.mjs';
import { reviewInput } from './julia-delivery-review.mjs';

const configuration = { builder: { harness: 'codex', model: 'builder', maker: 'OpenAI' }, reviewer: { harness: 'fixture', model: 'reviewer', maker: 'Other' } };
const authorization = { explicitStart: true, issueId: 'JUL-202', authorizedBy: 'fixture', spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } } };
const card = { identifier: 'JUL-202', description: '## Acceptance criteria\n- [ ] Reject unsupported approval.\n- [ ] Preserve inconclusive outcomes.' };
const commit = 'a'.repeat(40);

test('review input accepts the ballot-box criteria emitted by Linear', () => {
  const linearCard = { description: '## Acceptance criteria\n* ☐ First criterion.\n* ☑ Completed criterion.' };
  assert.deepEqual(reviewInput(linearCard, { commit }).criteria, ['First criterion.', 'Completed criterion.']);
});
// The public publication seam is a deterministic fixture here; GitHub API
// behavior has its own contract tests.
const runDelivery = (input, adapters) => deliver(input, {
  ...adapters,
  publishReview: adapters.publishReview ?? (async review => ({ confirmed: true, authoritative: review.state === 'completed', id: 1, url: 'https://example.invalid/review/1', pr: 1 })),
});
async function scenario(t, change = report => report, selected = configuration) {
  const root = await mkdtemp(join(tmpdir(), 'jul202-review-')); t.after(() => rm(root, { recursive: true, force: true }));
  const launches = [], prompts = [];
  const input = { issueId: 'JUL-202', configuration: selected, authorization, runPath: join(root, 'run.json') };
  const adapters = {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async () => ({ commit, clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      launches.push(role);
      if (role === 'builder') return { exitCode: 0, observed: selected.builder, text: 'PRIVATE BUILDER CONVERSATION' };
      prompts.push(request.prompt);
      const good = fixtureReport(request.reviewInput);
      const report = change(JSON.parse(good.split('REVIEW: ')[1]));
      return { exitCode: 0, observed: selected.reviewer, text: 'VERDICT: PASS\nREVIEW: ' + JSON.stringify(report) };
    },
  };
  const result = await runDelivery(input, adapters);
  assert.deepEqual(await runDelivery(input, adapters), result, 'restart reuses the terminal result');
  return { result, prompts, launches, state: JSON.parse(await readFile(join(root, 'JUL-202-state.json'), 'utf8')) };
}

test('complete unsupported, contradictory, wrong-version and incomplete reviews stay inconclusive without repair', async t => {
  const cases = {
    'candidate identity alone is not behavioral proof': report => { const identityOnly = { source: 'candidate', quote: commit, reasoning: 'The SHA matches, therefore behavior is correct.' }; for (const item of [report.standards, report.spec, ...report.criteria, ...report.files, ...report.checks, ...report.counterexamples, report.testAudit]) item.evidence = [identityOnly]; return report; },
    'invented underlying evidence': report => { report.spec.evidence[0].quote = 'claim not present in any raw source'; return report; },
    'no test discrimination': report => { report.testAudit.analysis = ''; return report; },
    'wrong candidate': report => ({ ...report, candidate: 'b'.repeat(40) }),
    'wrong input': report => ({ ...report, inputDigest: 'other checked evidence' }),
    'missing criterion': report => ({ ...report, criteria: report.criteria.slice(1) }),
    'missing file': report => ({ ...report, files: [] }),
    'missing standards check': report => ({ ...report, checks: report.checks.slice(1) }),
    'missing counterexample result': report => { report.counterexamples[0].result = ''; return report; },
    'uncertain evidence': report => { report.criteria[0].status = 'unverified'; return report; },
    'failed criterion under PASS': report => { report.criteria[0].status = 'failed'; return report; },
    'material limitation under PASS': report => ({ ...report, limitations: ['raw check was not executed'] }),
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const { result, launches, state } = await scenario(t, change);
    assert.equal(result.outcome, 'park'); assert.match(result.reason, /inconclusive/);
    assert.deepEqual(launches, ['builder', 'reviewer']);
    assert.equal(state.repairsUsed, 0); assert.deepEqual(state.findings, []);
  });
});
test('actual assembled reviewer prompt invokes the skill for every configured dispatch route', async t => {
  for (const harness of ['claude-code', 'codex', 'commandcode', 'omp', 'antigravity', 'other-supported-adapter']) await t.test(harness, async t => {
    const selected = { ...configuration, reviewer: { ...configuration.reviewer, harness } };
    const { result, prompts } = await scenario(t, report => report, selected);
    assert.equal(result.outcome, 'pass', 'supported fixture proves this gate can pass, not independent approval');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Explicitly read and follow \.agents\/skills\/adversarial-review\/SKILL\.md/);
    assert.match(prompts[0], /Independently challenge a checked candidate/);
    assert.doesNotMatch(prompts[0], /PRIVATE BUILDER CONVERSATION/);
  });
});

test('a repair re-review receives the persisted failed review and uses a targeted contract', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul202-targeted-review-')); t.after(() => rm(root, { recursive: true, force: true }));
  const reviews = [], handoffs = [];
  let candidates = 0;
  const result = await runDelivery({ issueId: 'JUL-202', configuration, authorization, runPath: join(root, 'run.json') }, {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async ({ afterReview, previous }) => afterReview ? previous : { commit: String(++candidates).padStart(40, 'a'), clean: true, checks: { pass: true } },
    launch: async (role, request) => {
      if (role === 'builder') return { exitCode: 0, observed: configuration.builder };
      reviews.push(request); handoffs.push(JSON.parse(await readFile(request.handoffPath, 'utf8')));
      return { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput, reviews.length === 1 ? 'FAIL' : 'PASS', 'Finding: fixture repair required') };
    },
  });
  assert.equal(result.outcome, 'pass', result.reason);
  assert.equal(reviews.length, 2, 'one initial review and one repair review');
  assert.equal(handoffs[1].priorReview.commit, handoffs[0].candidate.commit);
  assert.match(handoffs[1].priorReview.text, /fixture repair required/);
  assert.match(reviews[1].prompt, /repair review input/i);
  assert.match(reviews[1].prompt, /fixture repair required/i);
  assert.match(reviews[1].prompt, /durable report recorder/i);
  assert.doesNotMatch(reviews[1].prompt, /Output exactly VERDICT:/i);
});

test('a malformed repair review parks without a third review or repair', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul202-malformed-repair-')); t.after(() => rm(root, { recursive: true, force: true }));
  let builders = 0, reviewers = 0, candidates = 0; const publications = [];
  const result = await runDelivery({ issueId: 'JUL-202', configuration, authorization, runPath: join(root, 'run.json') }, {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async () => ({ commit: String(++candidates).padStart(40, 'a'), clean: true, checks: { pass: true } }),
    publishReview: async review => { publications.push(review); return { confirmed: true, authoritative: review.state === 'completed', id: publications.length, url: `https://example.invalid/review/${publications.length}`, pr: 1 }; },
    launch: async (role, request) => {
      if (role === 'builder') { builders++; return { exitCode: 0, observed: configuration.builder }; }
      reviewers++;
      if (reviewers === 1) return { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput, 'FAIL', 'Finding: fixture repair required') };
      const malformed = JSON.parse(fixtureReport(request.reviewInput).split('REVIEW: ')[1]);
      delete malformed.repairedFindings;
      return { exitCode: 0, observed: configuration.reviewer, text: `VERDICT: PASS\nREVIEW: ${JSON.stringify(malformed)}` };
    },
  });
  assert.equal(result.outcome, 'park');
  assert.match(result.reason, /repair review/);
  assert.equal(builders, 2);
  assert.equal(reviewers, 2);
  assert.equal(publications.at(-1).state, 'incomplete', 'malformed output is a visible non-authoritative attempt, never a completed verdict');
  assert.equal(publications.at(-1).verdict, 'INCONCLUSIVE');
});

test('a completed review is published once with its exact candidate and checked input before PASS', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul203-publication-')); t.after(() => rm(root, { recursive: true, force: true }));
  const published = [];
  const result = await runDelivery({ issueId: 'JUL-202', configuration, authorization, runPath: join(root, 'run.json') }, {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async ({ afterReview, previous }) => afterReview ? previous : { commit, clean: true, checks: { pass: true } },
    publishReview: async (review) => { published.push(review); return { confirmed: true, authoritative: true, id: 22, url: 'https://example.invalid/pull/22#review', pr: 22 }; },
    launch: async (role, request) => role === 'builder'
      ? { exitCode: 0, observed: configuration.builder }
      : { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput) },
  });
  assert.equal(result.outcome, 'pass', result.reason);
  assert.equal(published.length, 1);
  assert.deepEqual([published[0].round, published[0].candidate.commit, published[0].input.digest, published[0].verdict, published[0].state], [0, commit, published[0].input.digest, 'PASS', 'completed']);
  const state = JSON.parse(await readFile(join(root, 'JUL-202-state.json'), 'utf8'));
  assert.equal(state.actions.find(action => action.kind === 'publish-review').outcome.publication.url, 'https://example.invalid/pull/22#review');
});

test('a GitHub publication failure parks instead of reporting the review as successfully published', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul203-publication-failure-')); t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runDelivery({ issueId: 'JUL-202', configuration, authorization, runPath: join(root, 'run.json') }, {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async () => ({ commit, clean: true, checks: { pass: true } }),
    publishReview: async () => { throw new Error('GitHub read-back failed'); },
    launch: async (role, request) => role === 'builder'
      ? { exitCode: 0, observed: configuration.builder }
      : { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput) },
  });
  assert.equal(result.outcome, 'park');
  assert.match(result.reason, /durable GitHub review publication.*GitHub read-back failed/);
});

test('recovery after publication confirmation reuses its review identity without another authoritative record', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul203-publication-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runPath = join(root, 'run.json'), statePath = join(root, 'JUL-202-state.json');
  const identities = new Map(); let calls = 0, created = 0, losePersistence = true;
  const publishReview = async review => {
    calls += 1;
    const identity = `${review.round}:${review.candidate.commit}:${review.input.digest}:${review.verdict}:${review.state}`;
    if (!identities.has(identity)) { created += 1; identities.set(identity, { confirmed: true, authoritative: true, id: 29, url: 'https://example.invalid/pull/29#review', pr: 29 }); }
    return identities.get(identity);
  };
  const adapters = {
    readCard: async () => card, prepareReview: fixtureInput,
    candidate: async ({ afterReview, previous }) => afterReview ? previous : { commit, clean: true, checks: { pass: true } },
    publishReview,
    save: async (path, value) => {
      if (losePersistence && path === statePath && value.actions?.at(-1)?.kind === 'publish-review' && value.actions.at(-1).status === 'done') { losePersistence = false; throw new Error('runner died after GitHub confirmation'); }
      await saveJson(path, value);
    },
    load: loadText,
    launch: async (role, request) => role === 'builder'
      ? { exitCode: 0, observed: configuration.builder }
      : { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput) },
  };
  const input = { issueId: 'JUL-202', configuration, authorization, runPath };
  await assert.rejects(runDelivery(input, adapters), /runner died after GitHub confirmation/);
  const result = await runDelivery(input, adapters);
  assert.equal(result.outcome, 'pass', result.reason);
  assert.equal(calls, 2, 'the recovery confirms the already-published identity');
  assert.equal(created, 1, 'recovery did not create a duplicate authoritative review record');
  const publications = JSON.parse(await readFile(statePath, 'utf8')).actions.filter(action => action.kind === 'publish-review');
  assert.deepEqual(publications.map(action => action.status), ['interrupted', 'done']);
});
