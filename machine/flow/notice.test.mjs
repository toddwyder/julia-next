// The trouble notices: the 7 Nov 16:10:35 usage-limit failure that no one heard about, and
// the cases around it. Each case drives the real Lead processors through the real workflow,
// so the card and the run id in the notice are the run's own.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.CMD_API_KEY ??= 'unused-in-tests';

const { Agent } = await import('@mastra/core/agent');
const { createStep, createWorkflow } = await import('@mastra/core/workflows');
const { MastraLanguageModelV2Mock } = await import('@mastra/core/test-utils/llm-mock');
const { z } = await import('zod');
const { openMastra } = await import('./mastra.mjs');
const { createAgents } = await import('./agents.mjs');
const { installLeadModel } = await import('../../scripts/install-lead-model.mjs');
const { announceRestarts, classifyError, notice, noticeBody, noticeProcessors, TODD_PROFILE } = await import('./notice.mjs');

const CARD = 'JUL-341';
const LEAD_MODEL = 'openai/gpt-6.1-sol';

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-notice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What a provider rejection carries: the shape the AI SDK's AI_APICallError puts on the
// error the processor sees.
const apiError = ({ message, statusCode, isRetryable = false, responseBody = '', responseHeaders = {} }) =>
  Object.assign(new Error(message), { name: 'AI_APICallError', url: 'https://provider.test/v1/chat', requestBodyValues: {}, statusCode, isRetryable, responseBody, responseHeaders });

const USAGE_LIMIT = () => apiError({ message: 'The usage limit has been reached', statusCode: 429, isRetryable: true, responseBody: '{"error":{"message":"The usage limit has been reached"}}' });
const RATE_LIMIT = () => apiError({ message: 'Rate limit reached for requests', statusCode: 429, isRetryable: true, responseBody: '{"error":{"type":"rate_limit_error"}}', responseHeaders: { 'retry-after': '0' } });
const UNKNOWN_MODEL = () => apiError({ message: 'The model `nope-1` does not exist or you do not have access to it.', statusCode: 404, responseBody: '{"error":{"code":"model_not_found"}}' });
const DENIED = () => apiError({ message: 'You do not have permission for this resource', statusCode: 403, responseBody: '{"error":{"type":"permission_error"}}' });

const usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5 };
const streamOf = parts => ({ stream: new ReadableStream({ start(c) { c.enqueue({ type: 'stream-start', warnings: [] }); parts.forEach(part => c.enqueue(part)); c.close(); } }) });
const text = t => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const finish = reason => ({ type: 'finish', finishReason: reason, usage });

// The Lead on a scripted provider. `reply` is called once per model call with its number.
const leadOn = reply => {
  const model = new MastraLanguageModelV2Mock({
    provider: 'mock',
    modelId: 'lead',
    doStream: async () => {
      leadOn.calls += 1;
      return reply(leadOn.calls);
    },
  });
  return model;
};
leadOn.calls = 0;

async function runLead(t, { model, notify, card = CARD }) {
  const dir = temporary(t);
  const agent = new Agent({ id: 'flow-build', name: 'Lead', instructions: 'Reply with one line.', model, ...noticeProcessors({ model: LEAD_MODEL, notify }) });
  const prep = createStep({
    id: 'start-build',
    inputSchema: z.object({ card: z.string() }),
    outputSchema: z.object({ prompt: z.string() }),
    execute: async ({ inputData }) => ({ prompt: `Build Linear card ${inputData.card}.` }),
  });
  const workflow = createWorkflow({ id: 'card-path', inputSchema: z.object({ card: z.string() }), outputSchema: z.object({ text: z.string() }) })
    .then(prep)
    .then(createStep(agent))
    .commit();
  const mastra = await openMastra({ card, agents: { build: agent }, workflow, stateDb: join(dir, 'state.db'), traceDb: join(dir, 'trace.duckdb') });
  const run = await mastra.getWorkflow('card-path').createRun();
  const result = await run.start({ inputData: { card } });
  await mastra.shutdown?.();
  await new Promise(resolve => setTimeout(resolve, 300));
  return { result, runId: run.runId, dir };
}

const recorder = () => {
  const sent = [];
  const notify = async event => { sent.push(event); return { ...event, posted: true }; };
  return { sent, notify };
};

test('the Lead and every helper carry the notice processors', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  const roleModelsFile = join(dir, 'lead-role-models.md');
  installLeadModel(leadModelFile);
  writeFileSync(roleModelsFile, 'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash\n');
  const { build } = createAgents({ repo: process.cwd(), leadModelFile, roleModelsFile });
  const helper = Object.values(await build.listAgents())[0];
  for (const [name, agent] of [['Lead', build], ['helper', helper]]) {
    assert.deepEqual(await agent.getConfiguredErrorProcessorIds(), ['machine-notice-api-error'], `${name} has no notice error processor`);
    assert.deepEqual((await agent.listConfiguredOutputProcessors()).map(p => p.id), ['machine-notice-content-filter'], `${name} has no notice output processor`);
  }
});

test('the 7 Nov usage limit sends one notice naming the card, the model, the error and the run', async t => {
  leadOn.calls = 0;
  const { sent, notify } = recorder();
  const { result, runId } = await runLead(t, { model: leadOn(() => { throw USAGE_LIMIT(); }), notify });
  assert.equal(result.status, 'failed');
  assert.equal(sent.length, 1, `a usage limit sent ${sent.length} notices`);
  assert.equal(sent[0].kind, 'usage-limit');
  assert.equal(sent[0].card, CARD);
  assert.equal(sent[0].model, LEAD_MODEL);
  assert.equal(sent[0].runId, runId);
  assert.match(sent[0].detail, /usage limit has been reached/);
  assert.match(noticeBody({ kind: sent[0].kind, card: CARD, model: LEAD_MODEL, runId, detail: sent[0].detail, at: '2026-11-07T16:10:35.000Z' }), new RegExp(TODD_PROFILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a 429 that fails every retry sends one notice and one that recovers sends none', async t => {
  leadOn.calls = 0;
  const failing = recorder();
  const failed = await runLead(t, { model: leadOn(() => { throw RATE_LIMIT(); }), notify: failing.notify });
  assert.equal(failed.result.status, 'failed');
  assert.equal(failing.sent.length, 1, `a 429 that never recovered sent ${failing.sent.length} notices`);
  assert.equal(failing.sent[0].kind, 'rate-limit');

  leadOn.calls = 0;
  const recovering = recorder();
  const recovered = await runLead(t, {
    model: leadOn(n => {
      if (n === 1) throw RATE_LIMIT();
      return streamOf([...text('recovered'), finish('stop')]);
    }),
    notify: recovering.notify,
  });
  assert.equal(recovered.result.status, 'success');
  assert.equal(recovering.sent.length, 0, `a 429 that recovered still sent ${recovering.sent.length} notices`);
});

test('a refused model and an authorization block each send one notice', async t => {
  for (const [error, kind] of [[UNKNOWN_MODEL, 'model'], [DENIED, 'authorization']]) {
    leadOn.calls = 0;
    const { sent, notify } = recorder();
    const { result } = await runLead(t, { model: leadOn(() => { throw error(); }), notify });
    assert.equal(result.status, 'failed');
    assert.equal(sent.length, 1, `${kind} sent ${sent.length} notices`);
    assert.equal(sent[0].kind, kind);
  }
});

test('a content refusal sends one notice from the output step', async t => {
  leadOn.calls = 0;
  const { sent, notify } = recorder();
  await runLead(t, { model: leadOn(() => streamOf([finish('content-filter')])), notify });
  assert.equal(sent.length, 1, `a content refusal sent ${sent.length} notices`);
  assert.equal(sent[0].kind, 'content-filter');
  assert.equal(sent[0].card, CARD);
});

// Linear's three calls, answered in process: the issue id, the comment, the reminder.
const linear = () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables });
    const reply = data => ({ ok: true, json: async () => ({ data }) });
    if (query.includes('NoticeIssueId')) return reply({ issue: { id: 'issue-1' } });
    if (query.includes('commentCreate')) return reply({ commentCreate: { success: true, comment: { id: 'c1', url: 'https://linear.app/julia-next/issue/JUL-341#c1' } } });
    return reply({ issueReminder: { success: true } });
  };
  return { calls, fetchImpl };
};

/* The snapshot shape is the one a killed run leaves in state.db: status `running`, an empty
   `value` map, and the card on the workflow's own input. Measured with a real LibSQL store. */
test('a boot finds each run still marked running and notices each once', async t => {
  const stops = join(temporary(t), 'stops.jsonl');
  const { calls, fetchImpl } = linear();
  const storage = {
    getStore: async () => ({
      listWorkflowRuns: async () => ({
        runs: [
          { runId: 'ffc3d864', snapshot: { status: 'running', value: {}, context: { input: { card: 'JUL-341' } } }, updatedAt: new Date('2026-11-07T16:01:59Z') },
          { runId: 'done-run', snapshot: JSON.stringify({ status: 'success', value: { card: 'JUL-342' } }), updatedAt: new Date('2026-11-07T16:00:00Z') },
        ],
      }),
    }),
  };
  const sent = await announceRestarts({ storage, notify: event => notice(event, { apiKey: 'test', fetchImpl, stops }) });
  assert.equal(sent.length, 1, `a boot with one running run sent ${sent.length} notices`);
  assert.equal(sent[0].kind, 'restart');
  assert.equal(sent[0].runId, 'ffc3d864');
  assert.equal(sent[0].card, 'JUL-341');
  assert.equal(calls.length, 3);

  const again = await announceRestarts({ storage, notify: event => notice(event, { apiKey: 'test', fetchImpl, stops }) });
  assert.equal(again[0].posted, false);
  assert.equal(calls.length, 3, 'the second boot posted the same restart again');
  const lines = readFileSync(stops, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.filter(line => line.posted).length, 1);
  assert.equal(lines[0].runId, 'ffc3d864');
});

test('a notice mentions Todd, sets his reminder 30 seconds on, and records one line', async t => {
  const stops = join(temporary(t), 'julia', 'stops.jsonl');
  const { calls, fetchImpl } = linear();
  const now = () => new Date('2026-11-07T16:10:35.000Z');
  const sent = await notice(
    { kind: 'usage-limit', card: CARD, model: LEAD_MODEL, runId: 'ffc3d864', detail: 'AI_APICallError: The usage limit has been reached' },
    { apiKey: 'test', fetchImpl, stops, now },
  );
  assert.equal(sent.posted, true);
  assert.equal(sent.reminded, true);
  assert.equal(sent.remindAt, '2026-11-07T16:11:05.000Z');
  assert.equal(calls.length, 3);
  const body = calls.find(call => call.query.includes('commentCreate')).variables.body;
  assert.match(body, new RegExp(TODD_PROFILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const fact of [CARD, LEAD_MODEL, 'ffc3d864', 'The usage limit has been reached']) assert.match(body, new RegExp(fact));
  assert.equal(calls.find(call => call.query.includes('NoticeReminder')).variables.at, '2026-11-07T16:11:05.000Z');
  const lines = readFileSync(stops, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'usage-limit');
  assert.equal(lines[0].posted, true);
});

test('a notice that cannot reach Linear records the failure and returns instead of throwing', async t => {
  const stops = join(temporary(t), 'stops.jsonl');
  const sent = await notice(
    { kind: 'model', card: CARD, model: LEAD_MODEL, runId: 'ffc3d864', detail: 'AI_APICallError: model_not_found' },
    { apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ errors: [{ message: 'boom' }] }) }), stops },
  );
  assert.equal(sent.posted, false);
  assert.match(sent.error, /Linear API error/);
  const lines = readFileSync(stops, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].posted, false);
  assert.match(lines[0].error, /Linear API error/);
});

test('one failed notice does not stop the run from failing the way it did', async t => {
  leadOn.calls = 0;
  const { result } = await runLead(t, {
    model: leadOn(() => { throw USAGE_LIMIT(); }),
    notify: async () => { throw new Error('Linear is down'); },
  });
  assert.equal(result.status, 'failed');
  assert.match(String(result.error?.message), /usage limit has been reached/);
});

test('the classifier reads the provider wording before the status', () => {
  assert.equal(classifyError(USAGE_LIMIT(), 0), 'usage-limit');
  assert.equal(classifyError(RATE_LIMIT(), 0), null);
  assert.equal(classifyError(RATE_LIMIT(), 2), 'rate-limit');
  assert.equal(classifyError(UNKNOWN_MODEL(), 0), 'model');
  assert.equal(classifyError(DENIED(), 0), 'authorization');
  assert.equal(classifyError(apiError({ message: 'Bad request', statusCode: 400 }), 0), null);
});

// A notice has nowhere to post without a card, so it is recorded rather than dropped in silence.
// The agent that fails this way is one whose span chain reaches no card-path run.
test('a failure with no card in its span chain is recorded and posts nothing', async t => {
  const stops = join(temporary(t), 'stops.jsonl');
  const { calls, fetchImpl } = linear();
  const sent = await notice({ kind: 'usage-limit', model: LEAD_MODEL, runId: '', detail: 'AI_APICallError: The usage limit has been reached' }, { apiKey: 'test', fetchImpl, stops });
  assert.equal(sent.posted, false);
  assert.match(sent.error, /named no card/);
  assert.equal(calls.length, 0);
  const lines = readFileSync(stops, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'usage-limit');
  assert.equal(lines[0].posted, false);
});
