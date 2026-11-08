// A Studio API diagnostic for the helper budget. Run from a repository root:
//
//   node scripts/check-helper-budget.mjs [output.json]
//
// Set JUL342_KEEP_TRACE=1 to retain the scratch trace database.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { checkStudioStart } from './check-studio-start.mjs';

const SHOTS = process.env.JUL342_SHOTS;
const MODE = process.env.JUL342_MODE ?? 'run';

const HELPER = process.env.JUL342_HELPER ?? 'featureRefactoring';
const HELPER_ID = process.env.JUL342_HELPER_ID ?? 'pstack-feature-refactoring-1';
const STEPS = Number(process.env.JUL342_MAX_STEPS ?? 12);
const COUNT = Number(process.env.JUL342_COUNT ?? 24);
const delay = ms => new Promise(done => setTimeout(done, ms));

async function json(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { signal: AbortSignal.timeout(15000) });
  assert(response.ok, `Studio ${path} returned HTTP ${response.status}.`);
  return response.json();
}

function contains(value, target) {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some(item => contains(item, target));
  if (value && typeof value === 'object') return Object.values(value).some(item => contains(item, target));
  return false;
}

function descendant(span, ancestorId, byId) {
  let current = span;
  while (current?.parentSpanId) {
    if (current.parentSpanId === ancestorId) return true;
    current = byId.get(current.parentSpanId);
  }
  return false;
}

async function traceFor(port, runId) {
  const deadline = Date.now() + 240000;
  let last;
  let stable = 0;
  let previous = '';
  do {
    const list = await json(port, '/observability/traces');
    for (const item of list.spans ?? list.traces ?? []) {
      const trace = await json(port, `/observability/traces/${item.traceId}`);
      if (!contains(trace, runId)) continue;
      last = trace;
      const byId = new Map((trace.spans ?? []).map(span => [span.spanId, span]));
      const agents = trace.spans?.filter(span => span.spanType === 'agent_run') ?? [];
      const allEnded = agents.length && agents.every(agent => agent.endedAt && trace.spans.some(span => span.spanType === 'model_inference' && span.endedAt && descendant(span, agent.spanId, byId))) && trace.spans.every(span => span.endedAt);
      const fingerprint = JSON.stringify(trace.spans.map(span => [span.spanId, span.endedAt]).sort((a, b) => a[0].localeCompare(b[0])));
      stable = allEnded && fingerprint === previous ? stable + 1 : 0;
      previous = fingerprint;
      if (stable >= 2) return trace;
    }
    await delay(2000);
  } while (Date.now() < deadline);
  throw new Error(`Studio did not persist every agent inference for run ${runId}. Spans: ${JSON.stringify(last?.spans?.filter(span => ['agent_run', 'model_inference', 'tool_call'].includes(span.spanType)).map(span => ({ name: span.name, endedAt: span.endedAt })))}`);
}

async function stream(port, agentId, prompt) {
  const runId = randomUUID();
  const response = await fetch(`http://127.0.0.1:${port}/api/agents/${encodeURIComponent(agentId)}/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: prompt, runId, maxSteps: 20 }),
    signal: AbortSignal.timeout(1800000),
  });
  assert(response.ok, `Studio stream returned HTTP ${response.status}.`);
  // A 100-step helper run sends a very large event stream, so read it chunk by chunk and keep
  // only the events this proof reads.
  const events = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const take = line => {
    if (!line.startsWith('data:')) return;
    const body = line.slice(5).trim();
    if (!body || body === '[DONE]') return;
    const event = JSON.parse(body);
    if (event.type === 'tool-call') {
      events.push({ type: 'tool-call', payload: { toolName: event.payload?.toolName, args: event.payload?.args } });
    } else if (event.type === 'tool-result') {
      events.push({ type: 'tool-result', payload: { toolName: event.payload?.toolName,
        result: { text: event.payload?.result?.text, finishReason: event.payload?.result?.finishReason } } });
    } else if (event.type === 'error') {
      events.push(event);
    } else if (event.type === 'text-delta') {
      const last = events.at(-1);
      if (last?.type === 'text') last.text += event.payload?.text ?? '';
      else events.push({ type: 'text', text: event.payload?.text ?? '' });
    }
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, at).trim());
      buffer = buffer.slice(at + 1);
    }
  }
  take(buffer.trim());
  const errorEvent = events.find(event => event.type === 'error');
  if (errorEvent) assert.fail(`Studio stream returned a provider error for ${runId}: ${JSON.stringify(errorEvent.payload ?? errorEvent).slice(0, 1200)}`);
  return { runId, events, trace: await traceFor(port, runId) };
}

export async function checkHelperBudget() {
  // A chain of files, each naming the next, makes the helper read one file per tool call. No
  // single call can answer, so a helper cut short stops on a tool call with no text.
  const chain = resolve(process.cwd(), '.jul342-probe');
  mkdirSync(chain, { recursive: true });
  for (let number = 1; number <= COUNT; number += 1) {
    const name = String(number).padStart(2, '0');
    const next = number === COUNT ? 'end' : `next: ${String(number + 1).padStart(2, '0')}.txt`;
    writeFileSync(join(chain, `${name}.txt`), `${next}\n`);
  }
  const brief = [
    'You are the delegated helper. Follow the file chain below and report what you found.',
    'You have the mastra_workspace_read_file tool. Follow the chain below one file per tool call, in order.',
    `Call mastra_workspace_read_file on .jul342-probe/01.txt. Each file names the next file. Read that next file with another call, and keep going until a file says "end".`,
    'Use only mastra_workspace_read_file. Do not list files, search, grep, use a shell, or use any other tool. Make exactly one read call per file, one after another. Do not stop early and do not guess. When you reach the file that says "end", reply with only the name of that last file.',
  ].join(' ');
  const prompt = [
    'Do not edit the repository.',
    `Hand this job to the ${HELPER} helper and pass maxSteps: ${STEPS} in the delegation call. Do not do the work yourself and do not use any other helper.`,
    `Copy this job text to the helper word for word, adding nothing: ${JSON.stringify(brief)}`,
    'When the helper returns, repeat its answer in one line and stop.',
  ].join(' ');

  return checkStudioStart({ root: process.cwd(), timeoutMs: 240000,
    env: { ...process.env, NODE_ENV: 'development' }, onReady: async ({ port, dir }) => {
    const agents = await json(port, '/agents');
    const entry = Object.entries(agents).find(([, agent]) => agent.name === 'Lead');
    assert(entry, 'Studio does not list Lead.');
    const [agentId] = entry;
    const run = await stream(port, agentId, prompt);
    const byId = new Map(run.trace.spans.map(span => [span.spanId, span]));
    const helperRun = run.trace.spans.find(span => span.spanType === 'agent_run' && span.name === `agent run: '${HELPER_ID}'`);
    assert(helperRun, `Studio trace ${run.runId} has no ${HELPER_ID} agent run.`);
    const helperInferences = run.trace.spans.filter(span => span.spanType === 'model_inference' && descendant(span, helperRun.spanId, byId));
    const delegation = run.events.filter(event => event.type === 'tool-result' && event.payload?.toolName === `agent-${HELPER}`).at(-1);
    const delegationCall = run.events.find(event => event.type === 'tool-call' && event.payload?.toolName === `agent-${HELPER}`);
    const resultText = delegation?.payload?.result?.text?.trim() ?? '';
    const finish = delegation?.payload?.result?.finishReason ?? null;
    const toolCalls = run.trace.spans.filter(span => span.spanType === 'tool_call' && descendant(span, helperRun.spanId, byId));
    const faultSpan = run.trace.spans.find(span => span.attributes?.machineFault);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      for (const [label, path] of [['traces', '/traces'], ['trace', `/traces/${helperRun.traceId}`], ['agent', '/agents/flow-build']]) {
        try {
          await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(4000);
          await page.screenshot({ path: join(SHOTS, `${MODE}-${label}.png`), fullPage: true });
        } catch (error) {
          console.error(`screenshot ${path}: ${error.message}`);
        }
      }
      await browser.close();
    }
    return {
      runId: run.runId, traceId: helperRun.traceId, studioPort: port, maxStepsSent: STEPS,
      helper: HELPER_ID,
      traceDir: process.env.JUL342_KEEP_TRACE ? dir : null,
      delegationArgs: delegationCall?.payload?.args ?? null,
      helperDelegations: run.trace.spans.filter(span => span.spanType === 'agent_run' && span.name === `agent run: '${HELPER_ID}'`).length,
      helperSteps: helperInferences.length,
      helperToolCalls: toolCalls.length,
      helperFinishReason: finish,
      resultText,
      resultLength: resultText.length,
      machineFaultSpan: faultSpan ? { spanId: faultSpan.spanId, name: faultSpan.name, machineFault: faultSpan.attributes.machineFault } : null,
      leadInferences: run.trace.spans.filter(span => span.spanType === 'model_inference' && !descendant(span, helperRun.spanId, byId)).length,
      spans: run.trace.spans.filter(span => ['agent_run', 'tool_call'].includes(span.spanType)).map(span => ({ spanType: span.spanType, name: span.name, parentSpanId: span.parentSpanId, attributes: { success: span.attributes?.success, finishReason: span.attributes?.finishReason } })),
    };
  } });
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const outputFile = process.argv[2];
  try {
    const result = await checkHelperBudget();
    const output = JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2) + '\n';
    if (outputFile) writeFileSync(resolve(outputFile), output);
    console.log(output);
    if (process.env.JUL342_EXPECT_100) {
      assert.equal(result.checked.helperDelegations, 1, 'Expected exactly one helper delegation');
      assert.equal(result.checked.helperSteps, 100, 'Expected 100 helper inferences');
      assert.ok(result.checked.resultText && !result.checked.resultText.includes('DSML')
        && !result.checked.resultText.startsWith('Machine fault:'), 'Expected a written report');
    }
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
