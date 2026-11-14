import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createMockModel, simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { evaluateBuildCheck, proofsFromCard, realCheck } = await import('./check.mjs');
const { buildSpans, normalizeSpan } = await import('./trace.mjs');
const { buildCardPath } = await import('./workflow.mjs');
const { openMastra } = await import('./mastra.mjs');
const { openScratch } = await import('./scratch.mjs');

const CARD = 'JUL-340-CHECK';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

const span = fields => normalizeSpan({
  spanId: 's-0',
  parentSpanId: null,
  spanType: 'tool_call',
  name: 'tool',
  timestamp: '2026-11-14T00:00:00Z',
  endedAt: '2026-11-14T00:00:01Z',
  input: null,
  output: null,
  attributes: {},
  ...fields,
});

function studioRepo(dir) {
  const repo = join(dir, 'studio');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=flow@test', '-c', 'user.name=flow', 'commit', '--quiet', '-m', 'main']);
  return repo;
}

const cleanLeadSpans = () => [
  span({ spanId: 'wf-build', spanType: 'workflow_step', name: "workflow step: 'flow-build'" }),
  span({ spanId: 'lead', parentSpanId: 'wf-build', spanType: 'agent_run', name: 'flow-build' }),
  span({
    spanId: 't1', parentSpanId: 'lead', name: 'task_write',
    input: {
      tasks: [
        { id: '1', content: 'Read poteto-mode skill', status: 'pending' },
        { id: '2', content: 'Delegate implementation to helper', status: 'pending' },
        { id: '3', content: 'Verify with proof command', status: 'pending' },
      ],
    },
  }),
  span({ spanId: 'sk1', parentSpanId: 'lead', name: 'skill_read', input: { path: '.agents/skills/poteto-mode/SKILL.md' } }),
  span({ spanId: 't1-done', parentSpanId: 'lead', name: 'task_update', input: { id: '1', status: 'completed' } }),
  span({ spanId: 'helper', parentSpanId: 'lead', spanType: 'agent_run', name: 'pstack-feature-1' }),
  span({ spanId: 'w1', parentSpanId: 'helper', name: 'mastra_workspace_write_file', input: { path: 'app/page.jsx' } }),
  span({ spanId: 't2-done', parentSpanId: 'lead', name: 'task_update', input: { id: '2', status: 'completed' } }),
  span({ spanId: 'cmd1', parentSpanId: 'lead', name: 'mastra_workspace_execute_command', input: { command: 'npm test' } }),
  span({ spanId: 't3-done', parentSpanId: 'lead', name: 'task_complete', input: { id: '3' } }),
];

test('proofsFromCard extracts items from ## Proof and ## UAT steps', () => {
  assert.deepEqual(proofsFromCard('## Goal\nx\n\n## Proof\n- Run `npm test`\n- Screenshot home page\n'), [
    'Run `npm test`',
    'Screenshot home page',
  ]);
  assert.deepEqual(proofsFromCard('## UAT steps\n1. Open /recipes\n2. Save a recipe\n'), [
    'Open /recipes',
    'Save a recipe',
  ]);
  assert.deepEqual(proofsFromCard('## Proof\nA CI test reads the built agents.\n'), [
    'A CI test reads the built agents.',
  ]);
  assert.deepEqual(proofsFromCard('## Goal\nNothing here'), []);
});

test('buildSpans scopes to the latest flow-build span tree and parses JSON fields', async () => {
  const raw = [
    { eventType: 'end', spanId: 'old-wf', parentSpanId: null, spanType: 'workflow_step', name: "workflow step: 'flow-build'", timestamp: '2026-11-14T00:00:00Z' },
    { eventType: 'end', spanId: 'old-tool', parentSpanId: 'old-wf', spanType: 'tool_call', name: 'task_write', input: '{"tasks":[]}' },
    { eventType: 'end', spanId: 'new-wf', parentSpanId: null, spanType: 'workflow_step', name: "workflow step: 'flow-build'", timestamp: '2026-11-14T00:05:00Z' },
    { eventType: 'end', spanId: 'new-lead', parentSpanId: 'new-wf', spanType: 'agent_run', name: 'flow-build' },
    { eventType: 'end', spanId: 'new-tool', parentSpanId: 'new-lead', spanType: 'tool_call', name: 'task_write', input: '{"tasks":[{"id":"1","content":"step"}]}' },
    { eventType: 'end', spanId: 'other', parentSpanId: null, spanType: 'workflow_step', name: "workflow step: 'shipping'" },
  ];
  const scoped = await buildSpans({ spans: raw });
  assert.deepEqual(scoped.map(s => s.spanId), ['new-wf', 'new-lead', 'new-tool']);
  assert.deepEqual(scoped[2].input, { tasks: [{ id: '1', content: 'step' }] });

  const fromMastra = await buildSpans({
    mastra: { getStorage: () => ({ getStore: () => ({ getTrace: async () => ({ spans: raw }) }) }) },
    traceId: 'trace-1',
  });
  assert.deepEqual(fromMastra.map(s => s.spanId), ['new-wf', 'new-lead', 'new-tool']);
});

test('evaluateBuildCheck passes when all three facts hold', () => {
  const result = evaluateBuildCheck({
    spans: cleanLeadSpans(),
    changedFiles: ['app/page.jsx'],
    cardDescription: '## Proof\n- Run `npm test` and save output',
    evidenceFiles: [{ path: 'proof/npm-test.log', content: '12 tests passed', size: 15 }],
  });
  assert.deepEqual(result, { ok: true });
});

test('evaluateBuildCheck fails when lead wrote directly or via shell command (7 Nov font card fixture)', () => {
  const direct = evaluateBuildCheck({
    spans: [
      ...cleanLeadSpans(),
      span({ spanId: 'lead-write', parentSpanId: 'lead', name: 'mastra_workspace_edit_file', input: { path: 'app/secret.js' } }),
    ],
    changedFiles: ['app/page.jsx'],
  });
  assert.equal(direct.ok, false);
  assert.match(direct.reason, /app\/secret\.js/);

  // 7 Nov font card recorded run: Lead ran a shell command to edit layout.jsx and globals.css instead of delegating.
  const nov7FontSpans = [
    span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
    span({ spanId: 't1', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Read skill', status: 'pending' }, { id: '2', content: 'Verify fonts', status: 'pending' }] } }),
    span({ spanId: 'sk', parentSpanId: 'lead', name: 'skill_read', input: { path: '.agents/skills/poteto-mode/SKILL.md' } }),
    span({ spanId: 't1c', parentSpanId: 'lead', name: 'task_complete', input: { id: '1' } }),
    span({ spanId: 'sh', parentSpanId: 'lead', name: 'mastra_workspace_execute_command', input: { command: 'node -e "fs.writeFileSync(...)"' } }),
    span({ spanId: 't2c', parentSpanId: 'lead', name: 'task_complete', input: { id: '2' } }),
  ];
  const nov7 = evaluateBuildCheck({
    spans: nov7FontSpans,
    changedFiles: ['app/layout.jsx', 'app/globals.css'],
  });
  assert.equal(nov7.ok, false);
  assert.match(nov7.reason, /app\/layout\.jsx/);
  assert.match(nov7.reason, /app\/globals\.css/);
});

test('evaluateBuildCheck fails when a playbook step is ticked without matching work or left incomplete', () => {
  const missingSkill = evaluateBuildCheck({
    spans: [
      span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
      span({ spanId: 't1', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Read the architect skill', status: 'completed' }] } }),
    ],
  });
  assert.equal(missingSkill.ok, false);
  assert.match(missingSkill.reason, /Read the architect skill/);

  const missingHelper = evaluateBuildCheck({
    spans: [
      span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
      span({ spanId: 't1', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Delegate to helper', status: 'completed' }] } }),
    ],
  });
  assert.equal(missingHelper.ok, false);
  assert.match(missingHelper.reason, /Delegate to helper/);

  const missingProofStep = evaluateBuildCheck({
    spans: [
      span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
      span({ spanId: 't1', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Verify on matching surface', status: 'completed' }] } }),
    ],
  });
  assert.equal(missingProofStep.ok, false);
  assert.match(missingProofStep.reason, /Verify on matching surface/);

  const skippedOk = evaluateBuildCheck({
    spans: [
      span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
      span({ spanId: 't1', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Delegate to helper skip: one-line config', status: 'pending' }] } }),
    ],
  });
  assert.equal(skippedOk.ok, true);
});

test('evaluateBuildCheck fails when a named proof lacks valid saved evidence', () => {
  const trivial = evaluateBuildCheck({
    spans: cleanLeadSpans(),
    changedFiles: ['app/page.jsx'],
    cardDescription: '## Proof\n- Screenshot the cookbook grid',
    evidenceFiles: [{ path: 'proof/cookbook.txt', content: 'pass', size: 4 }],
  });
  assert.equal(trivial.ok, false);
  assert.match(trivial.reason, /Screenshot the cookbook grid/);

  const emptyMedia = evaluateBuildCheck({
    spans: cleanLeadSpans(),
    changedFiles: ['app/page.jsx'],
    cardDescription: '## Proof\n- Screenshot the cookbook grid',
    evidenceFiles: [{ path: 'proof/cookbook.png', content: '', size: 0 }],
  });
  assert.equal(emptyMedia.ok, false);
  assert.match(emptyMedia.reason, /Screenshot the cookbook grid/);
});

test('evaluateBuildCheck fails when only an unrelated repository note is present as evidence', () => {
  const card = '## UAT steps\n\n1. Open the preview of the recipe site. You see Playfair Display headings, Inter body text and Roboto Mono fixed-width text, as before.\n2. After the merge, open the dashboard. Its text shows in Public Sans, as before.\n';
  const spans = [
    span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
    span({ spanId: 't', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Implement fonts', status: 'completed' }] } }),
    span({ spanId: 'h', parentSpanId: 'lead', spanType: 'agent_run', name: 'pstack-feature-1' }),
    span({ spanId: 'w', parentSpanId: 'h', name: 'write_file', input: { path: 'app/layout.jsx' } }),
    span({ spanId: 'c', parentSpanId: 'lead', name: 'bash', input: { command: 'ls' } }),
  ];
  const ev = [{ path: 'docs/agents/cost-guard.md', content: 'The guard counts the cost of each call.', size: 40 }];
  const result = evaluateBuildCheck({ spans, changedFiles: ['app/layout.jsx'], cardDescription: card, evidenceFiles: ev });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no matching saved evidence/);
});

test('evaluateBuildCheck passes when a helper copies files in with a shell command', () => {
  const card = '## UAT steps\n\n1. Open the preview of the recipe site. You see Playfair Display headings, Inter body text and Roboto Mono fixed-width text, as before.\n';
  const spans = [
    span({ spanId: 'lead', spanType: 'agent_run', name: 'flow-build' }),
    span({ spanId: 't', parentSpanId: 'lead', name: 'task_write', input: { tasks: [{ id: '1', content: 'Implement fonts', status: 'completed' }] } }),
    span({ spanId: 'h', parentSpanId: 'lead', spanType: 'agent_run', name: 'pstack-feature-1' }),
    span({ spanId: 'w', parentSpanId: 'h', name: 'write_file', input: { path: 'app/layout.jsx' } }),
    span({ spanId: 'cp', parentSpanId: 'h', name: 'bash', input: { command: 'cp node_modules/@fontsource-variable/inter/files/*.woff2 app/fonts/' } }),
  ];
  const ev = [{ path: 'proof/fonts-preview.png', content: '', size: 1200 }];
  const result = evaluateBuildCheck({
    spans,
    changedFiles: ['app/layout.jsx', 'app/fonts/inter-latin-wght-normal.woff2'],
    cardDescription: card,
    evidenceFiles: ev,
  });
  assert.deepEqual(result, { ok: true });
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
  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: 'Reply with one line.',
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
  let result = await run.start({ inputData: { card: CARD, kind } });
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
        return calls === 1 ? { ok: false, reason: 'lead wrote directly: app/page.jsx' } : { ok: true };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(prompts.length, 2, 'build ran twice before Shipping');
  assert.match(prompts[1], /lead wrote directly: app\/page\.jsx/, 'second build prompt includes the check failure reason');
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
        return { ok: false, reason: calls === 1 ? 'task list: "Read skill" ticked without skill read' : 'evidence: "Run test" has no valid saved evidence' };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(shippingCalls.length, 0, 'Shipping never runs when check stops the card');
  assert.equal(result.status, 'success');
  assert.equal(result.result.stopped, true);
  assert.equal(result.result.landed, false);
  assert.match(reportText, /Part: check step/);
  assert.match(reportText, /stopped at the check step: \(1\) task list: "Read skill" ticked without skill read; \(2\) evidence: "Run test" has no valid saved evidence/);
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
        return calls === 1 ? { ok: false, reason: 'unattributed changes: app/layout.jsx' } : { ok: true };
      },
    },
  });

  assert.equal(result.result.stopped, true);
  assert.match(reportText, /Check returns: 1/);
  assert.match(reportText, /Shipping failures: 2/);
});

test('realCheck reads live Mastra trace, git copy diff and saved evidence files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-realcheck-'));
  process.env.FLOW_SCRATCH = join(dir, 'scratch');
  const repo = studioRepo(dir);
  openScratch(dir);
  const caseDir = join(dir, CARD);
  mkdirSync(join(caseDir, 'evidence'), { recursive: true });
  writeFileSync(join(caseDir, 'evidence', 'home.png'), 'png-bytes');
  writeFileSync(join(caseDir, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
  writeFileSync(join(caseDir, 'cursors.json'), '{}');

  const shippingCalls = [];
  let buildStep = 0;
  const { createTool } = await import('@mastra/core/tools');
  const { z } = await import('zod');
  const tool = (id, execute) => createTool({ id, description: id, inputSchema: z.object({}).passthrough(), execute });

  let helperStep = 0;
  const helper = new Agent({
    id: 'pstack-feature-1',
    name: 'Feature',
    instructions: 'Write code.',
    model: {
      specificationVersion: 'v2', provider: 'test', modelId: 'mock', supportedUrls: {},
      doStream: async () => {
        helperStep += 1;
        if (helperStep === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                { type: 'tool-call', toolCallId: 'hw1', toolName: 'mastra_workspace_write_file', input: JSON.stringify({ path: 'app/home.jsx' }) },
                { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'ht1' },
              { type: 'text-delta', id: 'ht1', delta: 'wrote app/home.jsx' },
              { type: 'text-end', id: 'ht1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
            ],
          }),
        };
      },
    },
    tools: { mastra_workspace_write_file: tool('mastra_workspace_write_file', async () => ({ ok: true })) },
    defaultOptions: { maxSteps: 5 },
  });

  const build = new Agent({
    id: 'flow-build',
    name: 'Flow build',
    instructions: 'Build.',
    model: {
      specificationVersion: 'v2', provider: 'test', modelId: 'mock', supportedUrls: {},
      doStream: async () => {
        buildStep += 1;
        const stepCalls = {
          1: [{ id: 'tc1', name: 'task_write', input: { tasks: [{ id: '1', content: 'Delegate to helper', status: 'pending' }, { id: '2', content: 'Verify home screenshot', status: 'pending' }] } }],
          2: [{ id: 'tc2', name: 'agent-feature', input: { prompt: 'write app/home.jsx' } }],
          3: [
            { id: 'tc3', name: 'task_update', input: { id: '1', status: 'completed' } },
            { id: 'tc4', name: 'mastra_workspace_execute_command', input: { command: 'node verify.mjs' } },
          ],
          4: [{ id: 'tc5', name: 'task_complete', input: { id: '2' } }],
        }[buildStep];
        if (stepCalls) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                ...stepCalls.map(c => ({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.input) })),
                { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'done' },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
        };
      },
    },
    agents: { feature: helper },
    tools: {
      task_write: tool('task_write', async () => ({ ok: true })),
      task_update: tool('task_update', async () => ({ ok: true })),
      task_complete: tool('task_complete', async () => ({ ok: true })),
      mastra_workspace_execute_command: tool('mastra_workspace_execute_command', async () => ({ ok: true })),
    },
    defaultOptions: { maxSteps: 10 },
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
          return { text: Promise.resolve('VERDICT: PASS\nCRITERION 1: PASS — ok\nNOTES: none') };
        },
      },
      remediation: stub('fixed'),
      retro: stub('retro'),
    },
    dir,
    repo,
    review: {
      findPr: () => ({ pr: 498 }),
      readCard: async identifier => ({ identifier, title: 'Real check', description: '## Acceptance criteria\n- works\n\n## Proof\n- Screenshot of home page' }),
      moveCard: async () => {},
      headCommit: () => 'abc123',
      postPrComment: () => {},
    },
    check: realCheck,
  });

  const mastra = await openMastra({
    card: CARD,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
    workflow,
  });
  const wf = mastra.getWorkflow(workflow.id);
  const run = await wf.createRun();
  const result = await run.start({ inputData: { card: CARD, kind: 'machine' } });
  assert.equal(result.status, 'success');
  assert.equal(result.result.checkPassed, true, result.result.checkReason);
  assert.equal(shippingCalls.length, 1);
  await mastra.shutdown();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});
