import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { RequestContext } = await import('@mastra/core/request-context');
const { simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { createAgents } = await import('./agents.mjs');
const { openMastra } = await import('./mastra.mjs');
const { buildCardPath } = await import('./workflow.mjs');
const { openScratch } = await import('./scratch.mjs');
const { readSpans, mergedSpans } = await import('./trace.mjs');
const { openSpending } = await import('./spending.mjs');
const { ROLE_GROUPS, formatSettings } = await import('../../dashboard/lib/model-settings.js');
const { initialChoice } = await import('../../dashboard/lib/roles.js');

const CARD = 'JUL-376-READONLY';
const LEAD_MODEL_ID = 'openai/gpt-6.1-sol';
const HELPER_MODEL_ID = 'commandcode/deepseek/deepseek-v4.1-flash';
const WRITE_TOOLS = [
  'mastra_workspace_write_file',
  'mastra_workspace_edit_file',
  'mastra_workspace_delete',
  'mastra_workspace_mkdir',
  'mastra_workspace_ast_edit',
  'mastra_workspace_apply_patch',
  'mastra_workspace_index_content',
];

const CATALOG = {
  source: 'a fake price list',
  costs: {
    openai: { models: { 'gpt-6.1-sol': { cost: { input: 2, output: 10 } } } },
    commandcode: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6 } } } },
  },
};

function fakeModel({ modelId = 'gpt-6.1-sol', provider = 'openai', steps = [], onOptions = () => {} }) {
  let step = 0;
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
  return {
    specificationVersion: 'v2',
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      onOptions(options, step);
      return { content: [{ type: 'text', text: 'ok' }], finishReason: 'stop', usage, warnings: [] };
    },
    async doStream(options) {
      onOptions(options, step);
      const current = steps[step] ?? { text: 'done' };
      step += 1;
      const calls = typeof current.toolCalls === 'function' ? current.toolCalls(options) : current.toolCalls;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...(calls
              ? calls.map((call, index) => ({
                  type: 'tool-call',
                  toolCallId: `c-${step}-${index}`,
                  toolName: call.name,
                  input: JSON.stringify(call.input ?? {}),
                }))
              : [
                  { type: 'text-start', id: '1' },
                  { type: 'text-delta', id: '1', delta: current.text ?? 'done' },
                  { type: 'text-end', id: '1' },
                ]),
            { type: 'finish', finishReason: calls ? 'tool-calls' : 'stop', usage },
          ],
        }),
        request: { body: '' },
        response: { headers: {} },
      };
    },
  };
}

function setupCase(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-lead-ro-'));
  t.after(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.agents/skills/poteto-mode'), { recursive: true });
  writeFileSync(join(repo, '.agents/skills/poteto-mode/SKILL.md'), '# Poteto mode\nTest skill.\n');
  writeFileSync(join(repo, 'README.md'), 'julia\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('add', '-A');
  git('-c', 'user.email=lead@test', '-c', 'user.name=Lead', 'commit', '--quiet', '-m', 'main');

  const leadModelFile = join(dir, 'lead-model');
  writeFileSync(leadModelFile, `${LEAD_MODEL_ID}\n`);

  const roleModelsFile = join(dir, 'lead-role-models.md');
  const models = [LEAD_MODEL_ID, HELPER_MODEL_ID, 'anthropic/claude-opus-5-5', 'commandcode/moonshotai/Kimi-K3.1-Pro']
    .map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds: models.map(m => m.id) }), lead: LEAD_MODEL_ID };
  writeFileSync(roleModelsFile, formatSettings(choice, models).pstack);

  const checkout = join(dir, 'checkout');
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, 'README.md'), 'checkout\n');
  const gitCheckout = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' });
  gitCheckout('init', '--quiet', '--initial-branch=main');
  gitCheckout('add', '-A');
  gitCheckout('-c', 'user.email=lead@test', '-c', 'user.name=Lead', 'commit', '--quiet', '-m', 'main');

  openScratch(dir);
  const spending = openSpending({
    dir,
    limit: 4,
    catalog: CATALOG,
    corrections: { freeModels: ['commandcode/inclusionai/ling-3.1-flash:free'] },
  });
  spending.begin(CARD);

  return { dir, repo, checkout, leadModelFile, roleModelsFile, spending };
}

async function runLead({ dir, repo, checkout, leadModelFile, roleModelsFile, spending, leadModel, helperModel }) {
  const agents = createAgents({
    model: 'openai/gpt-6.1-sol',
    leadModel,
    helperModel,
    repo,
    leadModelFile,
    roleModelsFile,
    dir,
    spending,
  });
  const workflow = buildCardPath({ agents, dir, repo });
  const mastra = await openMastra({
    card: CARD,
    agents,
    workflow,
    stateDb: join(dir, 'state.db'),
    traceDb: join(dir, 'trace.duckdb'),
  });
  const requestContext = new RequestContext();
  requestContext.set('cardCheckout', checkout);
  requestContext.set('mastra__threadId', `${CARD}/build-1`);
  requestContext.set('mastra__resourceId', CARD);
  try {
    const response = await agents.build.stream('Build the card.', { requestContext });
    const text = await response.text;
    return { text, agents };
  } finally {
    await mastra.shutdown();
  }
}

const toolNamesFromOptions = options =>
  Array.isArray(options.tools) ? options.tools.map(t => t.name) : Object.keys(options.tools ?? {});

const toolSpanName = span => String(span.attributes?.toolId ?? span.name ?? '').replace(/^tool:\s*'?|'?$/gi, '').trim();

test('Criterion 1: every write poteto-mode asks of the lead itself still works', async t => {
  const ctx = setupCase(t);
  let startTools = [];
  const leadModel = fakeModel({
    onOptions: (options, step) => {
      if (step === 0) startTools = toolNamesFromOptions(options);
    },
    steps: [
      {
        toolCalls: [
          {
            name: 'task_write',
            input: {
              tasks: [
                { id: '1', content: '1. how over the affected subsystem', activeForm: 'Exploring subsystem', status: 'completed' },
                { id: '2', content: '3. Blocking first steps: n/a single file', activeForm: 'Writing checkpoint', status: 'in_progress' },
              ],
            },
          },
          { name: 'task_complete', input: { id: '2' } },
          {
            name: 'mastra_workspace_execute_command',
            input: { command: 'printf "ts\\tphase\\tdecision\\twhy\\tevidence\\tresult\\n2026-11-13T00:00:00Z\\tbuild\\tdelegated\\treadOnly lead\\tdecisions.tsv\\tok\\n" > decisions.tsv' },
          },
          {
            name: 'mastra_workspace_execute_command',
            input: { command: 'git add decisions.tsv && git -c user.email=lead@test -c user.name=Lead commit -m "chore: log decision"' },
          },
        ],
      },
      { text: 'Checklist, decision log, and commit succeeded.' },
    ],
  });

  const { text } = await runLead({ ...ctx, leadModel, helperModel: fakeModel({ modelId: HELPER_MODEL_ID, provider: 'commandcode' }) });
  assert.equal(text, 'Checklist, decision log, and commit succeeded.');

  for (const writeTool of WRITE_TOOLS) {
    assert.ok(!startTools.includes(writeTool), `Lead must not be given ${writeTool} at start of run`);
  }
  assert.ok(startTools.includes('task_write'), 'Lead keeps task_write');
  assert.ok(startTools.includes('task_complete'), 'Lead keeps task_complete');
  assert.ok(startTools.includes('mastra_workspace_execute_command'), 'Lead keeps execute_command');

  const spans = mergedSpans(await readSpans(join(ctx.dir, 'trace.duckdb')));
  const toolSpans = spans.filter(s => s.spanType === 'tool_call');
  const toolCalls = toolSpans.map(toolSpanName);
  assert.ok(toolCalls.includes('task_write'), 'trace records task_write');
  assert.ok(toolCalls.includes('task_complete'), 'trace records task_complete');
  assert.ok(toolCalls.includes('mastra_workspace_execute_command'), 'trace records execute_command');
  const taskWriteSpan = toolSpans.find(s => toolSpanName(s) === 'task_write');
  assert.ok(taskWriteSpan.output != null && !/validation failed/i.test(JSON.stringify(taskWriteSpan.output)), `task_write output: ${JSON.stringify(taskWriteSpan.output)}`);
  const taskCompleteSpan = toolSpans.find(s => toolSpanName(s) === 'task_complete');
  assert.ok(taskCompleteSpan.output != null && !/validation failed/i.test(JSON.stringify(taskCompleteSpan.output)), `task_complete output: ${JSON.stringify(taskCompleteSpan.output)}`);
  assert.ok(existsSync(join(ctx.checkout, 'decisions.tsv')), 'decisions.tsv was written via shell');
});

test('Criterion 2: a lead that reaches to change the card work gets one clear answer and hands the change to a helper in the same run', async t => {
  const ctx = setupCase(t);
  let startTools = [];
  let secondPrompt = '';
  const leadModel = fakeModel({
    onOptions: (options, step) => {
      if (step === 0) startTools = toolNamesFromOptions(options);
      if (step === 1) secondPrompt = JSON.stringify(options.prompt);
    },
    steps: [
      {
        toolCalls: [
          { name: 'mastra_workspace_write_file', input: { path: 'work.txt', content: 'lead edit' } },
        ],
      },
      {
        toolCalls: [
          { name: 'agent-featureRefactoring', input: { prompt: 'Write work.txt with helper edit' } },
        ],
      },
      { text: 'Handed the change to featureRefactoring after write_file was unavailable.' },
    ],
  });

  const helperModel = fakeModel({
    modelId: HELPER_MODEL_ID,
    provider: 'commandcode',
    steps: [
      {
        toolCalls: [
          { name: 'mastra_workspace_write_file', input: { path: 'work.txt', content: 'helper edit\n' } },
        ],
      },
      { text: 'Wrote work.txt' },
    ],
  });

  const { text } = await runLead({ ...ctx, leadModel, helperModel });
  assert.match(text, /Handed the change to featureRefactoring/);

  for (const writeTool of WRITE_TOOLS) {
    assert.ok(!startTools.includes(writeTool), `Lead must not be given ${writeTool}`);
  }
  assert.match(secondPrompt, /Tool \\"mastra_workspace_write_file\\" not found/, 'Lead received one clear answer');
  assert.equal(readFileSync(join(ctx.checkout, 'work.txt'), 'utf8'), 'helper edit\n');

  const spans = mergedSpans(await readSpans(join(ctx.dir, 'trace.duckdb')));
  const helperRuns = spans.filter(s => s.spanType === 'agent_run' && /pstack-feature-refactoring/i.test(`${s.name} ${s.attributes?.agentId ?? ''}`));
  assert.equal(helperRuns.length, 1, 'trace records the helper run in the same trace');
});

test('Criterion 3: the change lands when a helper makes it', async t => {
  const ctx = setupCase(t);
  let helperStartTools = [];
  const leadModel = fakeModel({
    steps: [
      {
        toolCalls: [
          { name: 'agent-featureRefactoring', input: { prompt: 'Create feature.txt' } },
        ],
      },
      { text: 'Helper landed feature.txt.' },
    ],
  });

  const helperModel = fakeModel({
    modelId: HELPER_MODEL_ID,
    provider: 'commandcode',
    onOptions: (options, step) => {
      if (step === 0) helperStartTools = toolNamesFromOptions(options);
    },
    steps: [
      {
        toolCalls: [
          { name: 'mastra_workspace_write_file', input: { path: 'feature.txt', content: 'landed by helper\n' } },
        ],
      },
      { text: 'Created feature.txt' },
    ],
  });

  await runLead({ ...ctx, leadModel, helperModel });
  assert.ok(helperStartTools.includes('mastra_workspace_write_file'), 'helper keeps mastra_workspace_write_file');
  assert.ok(helperStartTools.includes('mastra_workspace_edit_file'), 'helper keeps mastra_workspace_edit_file');
  assert.equal(readFileSync(join(ctx.checkout, 'feature.txt'), 'utf8'), 'landed by helper\n');

  const spans = mergedSpans(await readSpans(join(ctx.dir, 'trace.duckdb')));
  const writeSpans = spans.filter(s => s.spanType === 'tool_call' && toolSpanName(s) === 'mastra_workspace_write_file');
  assert.equal(writeSpans.length, 1, 'trace records helper write_file call');
});

test('Criterion 4: the lead still reads the card work, runs its proofs, saves evidence and opens the pull request', async t => {
  const ctx = setupCase(t);
  writeFileSync(join(ctx.checkout, 'app.mjs'), 'export const value = 42;\n');
  let readOutput = '';

  const leadModel = fakeModel({
    onOptions: (options, step) => {
      if (step === 1) readOutput = JSON.stringify(options.prompt);
    },
    steps: [
      {
        toolCalls: [
          { name: 'mastra_workspace_read_file', input: { path: 'app.mjs' } },
        ],
      },
      {
        toolCalls: [
          {
            name: 'mastra_workspace_execute_command',
            input: { command: 'node -e "import(\'./app.mjs\').then(m => { if (m.value !== 42) process.exit(1); console.log(\'PROOF_OK\', m.value); })" > .artifacts/proof.txt' },
          },
          {
            name: 'mastra_workspace_execute_command',
            input: { command: 'git status --short' },
          },
        ],
      },
      { text: 'Read app.mjs, ran proof, saved .artifacts/proof.txt, checked git status for PR.' },
    ],
  });

  mkdirSync(join(ctx.checkout, '.artifacts'), { recursive: true });
  await runLead({ ...ctx, leadModel, helperModel: fakeModel({ modelId: HELPER_MODEL_ID, provider: 'commandcode' }) });

  assert.match(readOutput, /export const value = 42/, 'Lead read app.mjs');
  assert.match(readFileSync(join(ctx.checkout, '.artifacts/proof.txt'), 'utf8'), /PROOF_OK 42/, 'Lead saved proof evidence');

  const spans = mergedSpans(await readSpans(join(ctx.dir, 'trace.duckdb')));
  const toolCalls = spans.filter(s => s.spanType === 'tool_call').map(toolSpanName);
  assert.ok(toolCalls.includes('mastra_workspace_read_file'), 'trace records Lead read_file');
  assert.ok(toolCalls.includes('mastra_workspace_execute_command'), 'trace records Lead execute_command');
});
