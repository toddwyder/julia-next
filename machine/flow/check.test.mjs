import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createMockModel } = await import('@mastra/core/test-utils/llm-mock');
const { evaluateBuildCheck, realCheck } = await import('./check.mjs');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');

const CARD = 'JUL-340-CHECK';
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

const SAMPLE_STEPS = [
  '`how` over the affected subsystem.',
  '`architect` for parallel design exploration.',
  'Run **Opening a PR**.',
];

test('evaluateBuildCheck passes when every playbook step is completed or skipped with a reason', () => {
  const tasks = [
    { id: 'playbook_1', content: SAMPLE_STEPS[0], status: 'completed' },
    { id: 'playbook_2', content: `${SAMPLE_STEPS[1]} skip: single-file change`, status: 'pending' },
    { id: 'playbook_3', content: SAMPLE_STEPS[2], status: 'completed' },
  ];
  assert.deepEqual(evaluateBuildCheck({ tasks, steps: SAMPLE_STEPS, playbook: 'feature' }), { ok: true });
});

test('evaluateBuildCheck fails when a playbook is missing, a step is missing, or a step is incomplete without skip', () => {
  assert.deepEqual(evaluateBuildCheck({ tasks: [], steps: [], playbook: '' }), {
    ok: false,
    reasons: ['playbook: no playbook chosen'],
    reason: 'playbook: no playbook chosen',
  });
  assert.deepEqual(evaluateBuildCheck({ tasks: [], steps: SAMPLE_STEPS, playbook: 'feature' }), {
    ok: false,
    reasons: ['task list: no tasks recorded'],
    reason: 'task list: no tasks recorded',
  });

  const incomplete = [
    { id: 'playbook_1', content: SAMPLE_STEPS[0], status: 'completed' },
    { id: 'playbook_2', content: SAMPLE_STEPS[1], status: 'in_progress' },
  ];
  const result = evaluateBuildCheck({ tasks: incomplete, steps: SAMPLE_STEPS, playbook: 'feature' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, [
    `task list: "${SAMPLE_STEPS[1]}" is in_progress`,
    `playbook: missing step "${SAMPLE_STEPS[2]}"`,
  ]);
});

test('realCheck reads Mastra threadState task list for the lead thread', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-realcheck-'));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.agents/skills/poteto-mode/playbooks'), { recursive: true });
  writeFileSync(join(repo, '.agents/skills/poteto-mode/playbooks/feature.md'), '### Feature\n\n1. Step one.\n2. Step two.\n');

  const store = new Map();
  const mastra = {
    getStorage: () => ({
      getStore: async name => (name === 'threadState' ? {
        getState: async ({ threadId, type }) => store.get(`${threadId}:${type}`) ?? null,
      } : null),
    }),
  };

  store.set('JUL-362/build-1:task', [
    { id: 'playbook_1', content: 'Step one.', status: 'completed' },
    { id: 'playbook_2', content: 'Step two. skip: not needed', status: 'pending' },
  ]);
  const pass = await realCheck.run({ mastra, threadId: 'JUL-362/build-1', playbook: 'feature', repo });
  assert.deepEqual(pass, { ok: true });

  store.set('JUL-362/build-1:task', [
    { id: 'playbook_1', content: 'Step one.', status: 'pending' },
  ]);
  const fail = await realCheck.run({ mastra, threadId: 'JUL-362/build-1', playbook: 'feature', repo });
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.reasons, [
    'task list: "Step one." is pending',
    'playbook: missing step "Step two."',
  ]);
});

async function runCheckFlow({ check, review = ['PASS'], kind = 'machine', answers = ['yes'] }) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-check-'));
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  const repo = studioRepo(dir);
  openScratch(dir);
  const caseDir = join(dir, CARD);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');

  const prompts = [];
  const shippingCalls = [];
  const queue = [...review];
  const TASK_TOOL_STUBS = {
    task_write: { id: 'task_write' },
    task_update: { id: 'task_update' },
    task_complete: { id: 'task_complete' },
    task_check: { id: 'task_check' },
  };

  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: 'Reply with one line.',
    tools: TASK_TOOL_STUBS,
    model: createMockModel({
      mockText: 'built line',
      spyStream: props => prompts.push(JSON.stringify(props)),
    }),
  });
  const stub = text => ({
    generate: async () => { throw new Error('Bad Request: Stream must be set to true'); },
    stream: async () => ({ text: Promise.resolve(text) }),
  });
  const workflow = buildCardPath({
    agents: {
      build,
      shipping: {
        stream: async task => {
          shippingCalls.push(task);
          const next = queue.shift() ?? 'PASS';
          return { text: Promise.resolve(`VERDICT: ${next}\nCRITERION 1: ${next} — ok\nNOTES: none`) };
        },
      },
      remediation: stub('fixed'),
      retro: stub('retro'),
    },
    dir,
    repo,
    review: {
      findPr: () => ({ pr: 498 }),
      readCard: async identifier => ({ identifier, title: 'Check card', description: '## Acceptance criteria\n- works' }),
      moveCard: async () => {},
      headCommit: () => 'abc123',
      postPrComment: () => {},
    },
    check,
  });
  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const result = await run.start({ inputData: { card: CARD, kind } });
  const report = join(caseDir, 'reports', `${CARD}.md`);
  const reportText = existsSync(report) ? readFileSync(report, 'utf8') : '';
  await mastra.shutdown();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  return { result, prompts, shippingCalls, reportText, answers };
}

test('workflow sends a failed check back to build with the reason and proceeds to Shipping when it passes', async () => {
  let calls = 0;
  const { result, prompts, shippingCalls } = await runCheckFlow({
    check: {
      run: async () => {
        calls += 1;
        return calls === 1 ? { ok: false, reason: 'task list: no tasks recorded' } : { ok: true };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(prompts.length, 2, 'build ran twice before Shipping');
  assert.match(prompts[1], /task list: no tasks recorded/, 'second build prompt includes the check failure reason');
  assert.equal(shippingCalls.length, 1, 'Shipping ran once after check passed');
  assert.equal(result.status, 'success');
  assert.equal(result.result.landed, true);
});

test('a second check failure stops at the check step with both reasons and separate report counts', async () => {
  let calls = 0;
  const { result, shippingCalls, reportText } = await runCheckFlow({
    kind: 'product',
    check: {
      run: async () => {
        calls += 1;
        return { ok: false, reason: calls === 1 ? 'task list: "Step 1" is pending' : 'playbook: missing step "Step 2"' };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(shippingCalls.length, 0, 'Shipping never runs when check stops the card');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(result.result.landed, false);
  assert.match(reportText, /Part: check step/);
  assert.match(reportText, /stopped at the check step: \(1\) task list: "Step 1" is pending; \(2\) playbook: missing step "Step 2"/);
  assert.match(reportText, /Check returns: 2/);
  assert.match(reportText, /Shipping failures: 0/);
});

test('a card report counts check returns and Shipping failures on separate lines', async () => {
  let calls = 0;
  const { result, reportText } = await runCheckFlow({
    review: ['FAIL', 'FAIL'],
    check: {
      run: async () => {
        calls += 1;
        return calls === 1 ? { ok: false, reason: 'task list: no tasks recorded' } : { ok: true };
      },
    },
  });

  assert.equal(result.result.stopped, true);
  assert.match(reportText, /Check returns: 1/);
  assert.match(reportText, /Shipping failures: 2/);
});

test('a fatal check failure stops the card immediately with a report naming the check step and cause', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-check-fatal-'));
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  const repo = studioRepo(dir);
  openScratch(dir);
  const caseDir = join(dir, CARD);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');

  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: 'Build.',
    model: createMockModel({ mockText: 'built' }),
    tools: { task_write: { id: 'task_write' }, task_update: { id: 'task_update' }, task_complete: { id: 'task_complete' }, task_check: { id: 'task_check' } },
  });
  const stub = (text) => ({ stream: async () => ({ text: Promise.resolve(text) }) });
  const workflow = buildCardPath({
    agents: { build, shipping: stub('VERDICT: PASS\nCRITERION 1: PASS — ok\nNOTES: none'), remediation: stub('fixed'), retro: stub('retro') },
    dir,
    repo,
    review: {
      findPr: () => ({ pr: 499 }),
      readCard: async identifier => ({ identifier, title: 'Fatal check', description: '## Acceptance criteria\n- works' }),
      moveCard: async () => {},
      headCommit: () => 'abc123',
      postPrComment: () => {},
    },
    check: { run: async () => ({ ok: false, fatal: true, reason: 'JavaScript heap out of memory' }) },
  });

  const mastra = await openMastra({ card: CARD, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb'), workflow });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'machine' } });
  const reportText = readFileSync(join(caseDir, 'reports', `${CARD}.md`), 'utf8');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.match(reportText, /Part: check step/);
  assert.match(reportText, /JavaScript heap out of memory/);
  await mastra.shutdown();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});
