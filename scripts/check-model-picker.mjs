import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { accountModels } from '../dashboard/lib/account-models.js';
import { displayName } from '../dashboard/lib/models.js';
import { ROLE_GROUPS, leadModels, readSettings, settingsPaths } from '../dashboard/lib/model-settings.js';
import { helperKey, readRoleModels } from '../machine/flow/role-models.mjs';
import { checkStudioStart } from './check-studio-start.mjs';

const MARKER = 'JUL340_MODEL_OK';
const delay = ms => new Promise(done => setTimeout(done, ms));
const sha = value => createHash('sha256').update(value).digest('hex');

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

async function json(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Studio ${path} returned HTTP ${response.status}.`);
  return response.json();
}

function contains(value, target) {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some(item => contains(item, target));
  if (value && typeof value === 'object') return Object.values(value).some(item => contains(item, target));
  return false;
}

async function traceFor(port, runId) {
  const deadline = Date.now() + 45000;
  let last;
  do {
    const list = await json(port, '/observability/traces');
    for (const item of list.spans ?? list.traces ?? []) {
      const trace = await json(port, `/observability/traces/${item.traceId}`);
      if (!contains(trace, runId)) continue;
      last = trace;
      const byId = new Map((trace.spans ?? []).map(span => [span.spanId, span]));
      const agents = trace.spans?.filter(span => span.spanType === 'agent_run') ?? [];
      if (agents.length && agents.every(agent => trace.spans.some(span => span.spanType === 'model_inference'
        && span.endedAt && descendant(span, agent.spanId, byId)))) return trace;
    }
    await delay(1000);
  } while (Date.now() < deadline);
  throw new Error(`Studio did not persist every agent inference for run ${runId}. Spans: ${JSON.stringify(last?.spans?.filter(span => ['agent_run', 'model_inference', 'tool_call'].includes(span.spanType)).map(span => ({ name: span.name, id: span.spanId, parent: span.parentSpanId, endedAt: span.endedAt, model: span.attributes?.model })))}`);
}

async function stream(port, agentId, prompt, options = {}) {
  const runId = randomUUID();
  const response = await fetch(`http://127.0.0.1:${port}/api/agents/${encodeURIComponent(agentId)}/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: prompt, runId, maxSteps: options.maxSteps ?? 3, ...options }),
    signal: AbortSignal.timeout(180000),
  });
  assert(response.ok, `Studio stream returned HTTP ${response.status}.`);
  const wire = await response.text();
  const events = wire.split('\n').filter(line => line.startsWith('data:')).map(line => {
    const body = line.slice(5).trim();
    return body === '[DONE]' ? null : JSON.parse(body);
  }).filter(Boolean);
  assert(!events.some(event => event.type === 'error'), `Studio stream returned a provider error for ${runId}.`);
  return { runId, events, trace: await traceFor(port, runId) };
}

function exactModel(span, expected) {
  const [provider, ...parts] = expected.split('/');
  const model = parts.join('/');
  const actualProvider = span.attributes?.provider ?? '';
  return span.attributes?.model === model && (provider === 'commandcode' ? actualProvider === provider : actualProvider.startsWith(provider));
}

function descendant(span, ancestorId, byId) {
  let current = span;
  while (current?.parentSpanId) {
    if (current.parentSpanId === ancestorId) return true;
    current = byId.get(current.parentSpanId);
  }
  return false;
}

function inspectInference(run, agentName, expected) {
  const byId = new Map(run.trace.spans.map(span => [span.spanId, span]));
  const agent = run.trace.spans.find(span => span.spanType === 'agent_run' && span.name === `agent run: '${agentName}'`);
  assert(agent, `Studio trace ${run.runId} has no ${agentName} agent run.`);
  const inferences = run.trace.spans.filter(span => span.spanType === 'model_inference' && descendant(span, agent.spanId, byId));
  assert(inferences.length, `Studio trace ${run.runId} has no inference inside ${agentName}.`);
  assert(inferences.some(span => exactModel(span, expected)), `Studio trace ${run.runId} used ${inferences.map(span => `${span.attributes?.provider}/${span.attributes?.model}`).join(', ')} inside ${agentName}, expected ${expected}.`);
  return { runId: run.runId, traceId: agent.traceId, agent: agentName, model: expected,
    inferenceSpans: inferences.map(span => ({ spanId: span.spanId, provider: span.attributes.provider, model: span.attributes.model,
      usage: span.attributes.usage ?? null })) };
}

function wrongModel(saved, available) {
  const wrong = available.find(model => model !== saved);
  assert(wrong, 'A second model is required to demonstrate a mismatch.');
  return wrong;
}

function mismatched(label, check) {
  let caught;
  try { check(); } catch (error) { caught = error; }
  assert(caught instanceof assert.AssertionError, `${label} accepted a mismatched pick.`);
  return { verdict: 'FAIL', reason: caught.message };
}

async function modelRun(port, agentId, expected, alternatives) {
  const run = await stream(port, agentId,
    `This is a harmless JUL-340 model connectivity check, not a card. Do not use tools. Reply with exactly ${MARKER}.`,
    { maxSteps: 1, toolChoice: 'none', activeTools: [] });
  const answer = run.events.filter(event => event.type === 'text-delta').map(event => event.payload?.text ?? '').join('').trim();
  assert.equal(answer, MARKER, `${expected} did not answer the short Lead request.`);
  const pass = inspectInference(run, 'flow-build', expected);
  const wrong = wrongModel(expected, alternatives);
  return { ...pass, savedVerdict: 'PASS', mismatchedPick: wrong,
    mismatch: mismatched(`Lead ${expected}`, () => inspectInference(run, 'flow-build', wrong)) };
}

async function helperRun(port, agentId, role, index, expected, leadExpected, alternatives) {
  const key = helperKey(role, index);
  const input = `cobalt${randomUUID().slice(0, 6)}`;
  const answer = [...input].reverse().join('');
  const which = role.models.length > 1 ? ` choice ${index + 1}, configured for ${expected},` : '';
  const prompt = `This is a harmless JUL-340 delegation check, not a card. Give the ${role.name} pstack helper${which} one tiny job: reverse the string ${input} and reply with only the reversed string. Wait for its answer, then repeat that answer.`;
  const run = await stream(port, agentId, prompt);
  const tool = run.trace.spans.find(span => span.spanType === 'tool_call' && span.name === `tool: 'agent-${key}'`);
  assert(tool, `Lead did not call agent-${key} successfully in Studio run ${run.runId}. Events: ${JSON.stringify(run.events.filter(event => ['tool-call', 'tool-result', 'error'].includes(event.type)).map(event => ({ type: event.type, tool: event.payload?.toolName, result: event.payload?.result }))).slice(0, 1200)}. Spans: ${JSON.stringify(run.trace.spans.filter(span => span.spanType === 'tool_call').map(span => ({ name: span.name, success: span.attributes?.success })))}`);
  const result = run.events.find(event => event.type === 'tool-result' && event.payload?.toolName === `agent-${key}`);
  assert.equal(result?.payload?.result?.text?.trim().split(/\r?\n/)[0].trim(), answer, `The ${role.name} helper did not reverse the string in Studio run ${run.runId}. Tool events: ${JSON.stringify(run.events.filter(event => ['tool-call', 'tool-result', 'error'].includes(event.type)).map(event => ({ type: event.type, tool: event.payload?.toolName, result: event.payload?.result }))).slice(0, 1500)}`);
  assert.notEqual(tool.attributes?.success, false, `The ${role.name} helper tool failed in Studio run ${run.runId}.`);
  const proof = inspectInference(run, `pstack-${role.id}-${index + 1}`, expected);
  const leadProof = inspectInference(run, 'flow-build', leadExpected);
  const agentSpan = run.trace.spans.find(span => span.spanType === 'agent_run' && span.name === `agent run: 'pstack-${role.id}-${index + 1}'`);
  assert.equal(agentSpan.parentSpanId, tool.spanId, `The ${role.name} helper inference was not nested under Lead's helper call.`);
  const wrong = wrongModel(expected, alternatives);
  return { ...proof, role: role.name, helper: key, toolSpanId: tool.spanId, leadInferences: leadProof.inferenceSpans,
    savedVerdict: 'PASS', mismatchedPick: wrong,
    mismatch: mismatched(`${role.name} ${expected}`, () => inspectInference(run, `pstack-${role.id}-${index + 1}`, wrong)) };
}

async function withDashboard(run) {
  const port = await freePort();
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const child = spawn(join(root, 'dashboard/node_modules/.bin/next'), ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: join(root, 'dashboard'), detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
  let log = '';
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { log = (log + chunk).slice(-12000); });
  try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Dashboard exited: ${log}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/start`, { signal: AbortSignal.timeout(15000) });
        if (response.ok) return await run(`http://127.0.0.1:${port}/start`);
      } catch {}
      await delay(1000);
    }
    throw new Error(`Dashboard did not serve /start: ${log}`);
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
}

async function browserSave(url, current, models, alternateLead, alternateCoder) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Change the Lead model' }).waitFor();
    const visible = [];
    const leadName = displayName(models.find(model => model.id === current.lead));
    const leadButton = page.getByRole('button', { name: 'Change the Lead model' });
    const leadText = await leadButton.innerText();
    assert.equal(await leadButton.getAttribute('data-current-model-id'), current.lead);
    assert(leadText.includes(leadName));
    const wrongLead = displayName(models.find(model => model.id === wrongModel(current.lead, leadModels(models).map(model => model.id))));
    const leadMismatch = mismatched('Lead Start row', () => assert(leadText.includes(wrongLead)));
    for (const group of ROLE_GROUPS) {
      for (const role of group.roles) {
        const expected = current.groups[group.id].roles[role.id];
        const names = [expected].flat().map(id => displayName(models.find(model => model.id === id)));
        const row = page.locator(`#roles-${group.id} > li`).filter({ hasText: role.name }).first();
        const text = await row.innerText();
        const actualIds = await row.locator('[data-current-model-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-current-model-id')));
        assert.deepEqual(actualIds, [expected].flat(), `The Start screen model IDs differ for ${role.name}.`);
        assert(names.every(name => text.includes(name)), `The Start screen does not show saved model(s) for ${role.name}.`);
        const wrong = models.find(model => !actualIds.includes(model.id)).id;
        visible.push({ role: role.name, models: actualIds, savedVerdict: 'PASS', mismatchedPick: wrong,
          mismatch: mismatched(`${role.name} Start row`, () => assert(actualIds.includes(wrong))) });
      }
    }
    await page.getByRole('button', { name: 'Change the Lead model' }).click();
    await page.locator(`[role="dialog"] [data-model-id="${alternateLead}"]`).click();
    await page.getByRole('button', { name: 'Change the feature, refactoring model' }).click();
    await page.locator(`[role="dialog"] [data-model-id="${alternateCoder}"]`).click();
    await page.getByText('Picks are not applied until you press Save. Restart Studio after saving.').waitFor();
    const [response] = await Promise.all([
      page.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === new URL(url).pathname),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    assert(response.ok(), `Save returned HTTP ${response.status()}.`);
    try { await page.getByText('Saved on this machine. Restart Studio in its terminal before the next run.').waitFor({ timeout: 20000 }); }
    catch { throw new Error(`The Start screen did not confirm the Save. It says: ${await page.locator('[role="alert"]').first().innerText().catch(() => 'no problem')}`); }
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Change the Lead model' }).getAttribute('data-current-model-id'), alternateLead);
    assert.equal(await page.getByRole('button', { name: 'Change the feature, refactoring model' }).getAttribute('data-current-model-id'), alternateCoder);
    const screenshot = resolve('docs/agents/jul-340/start-saved.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    return { url, screenshot, savedLead: alternateLead, savedCoder: alternateCoder, lead: { model: current.lead, savedVerdict: 'PASS', mismatch: leadMismatch }, visibleRoles: visible };
  } finally { await browser.close(); }
}

export async function checkModelPicker() {
  const roleProbe = process.env.JUL340_ROLE_PROBE;
  const paths = settingsPaths();
  const originals = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, existsSync(file) ? readFileSync(file) : null]));
  const originalHashes = Object.fromEntries(Object.entries(originals).map(([key, value]) => [key, value === null ? null : sha(value)]));
  const models = await accountModels();
  const leadList = leadModels(models).map(model => model.id);
  assert(leadList.length > 1, 'Lead needs at least two account models for the mismatch proof.');
  const current = readSettings({ paths, modelIds: models.map(model => model.id) });
  const alternateLead = leadList.find(id => id.endsWith('/gpt-6-luna') && id !== current.lead) ?? wrongModel(current.lead, leadList);
  const coder = current.groups.building.roles['feature-refactoring'];
  const codingOptions = models.filter(model => model.provider === 'commandcode').map(model => model.id);
  const alternateCoder = codingOptions.find(id => id === 'commandcode/deepseek/deepseek-v4-flash' && id !== coder) ?? wrongModel(coder, codingOptions);
  const proof = { card: 'JUL-340', checkedAt: new Date().toISOString(), originalHashes, accountLeadModels: leadList };
  let failure;
  try {
    proof.criterion1 = await withDashboard(url => browserSave(url, current, models, alternateLead, alternateCoder));
    const saved = readSettings({ paths, modelIds: models.map(model => model.id) });
    assert.equal(saved.lead, alternateLead, 'The browser Save did not persist the Lead model.');
    assert.equal(saved.groups.building.roles['feature-refactoring'], alternateCoder, 'The browser Save did not persist the coding model.');
    const roles = readRoleModels();
    assert.equal(roles.length, ROLE_GROUPS.reduce((count, group) => count + group.roles.length, 0));
    for (const role of roles) assert.deepEqual(role.models, [saved.groups[role.group].roles[role.id]].flat());
    proof.savedHashes = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, sha(readFileSync(file))]));

    const env = { ...process.env, NODE_ENV: 'development' };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
    const savedStudio = await checkStudioStart({ env, onReady: async ({ port }) => {
      const agents = await json(port, '/agents');
      const entry = Object.entries(agents).find(([, agent]) => agent.name === 'Lead');
      assert(entry, 'Studio does not list Lead.');
      const [agentId] = entry;
      return modelRun(port, agentId, saved.lead, leadList);
    } });
    assert.deepEqual(savedStudio.failures, []);
    proof.criterion3 = savedStudio.checked;
    proof.criterion2 = [savedStudio.checked];
    for (const model of roleProbe ? [] : leadList.filter(id => id !== saved.lead)) {
      const directory = mkdtempSync(join(tmpdir(), 'jul340-lead-model-'));
      const file = join(directory, 'lead-model');
      writeFileSync(file, `${model}\n`);
      try {
        const run = await checkStudioStart({ env: { ...env, JULIA_LEAD_MODEL_FILE: file }, onReady: async ({ port }) => {
          const agents = await json(port, '/agents');
          const agentId = Object.entries(agents).find(([, agent]) => agent.name === 'Lead')?.[0];
          assert(agentId, 'Studio does not list Lead.');
          return modelRun(port, agentId, model, leadList);
        } });
        proof.criterion2.push(run.checked);
        console.error(`Checked Lead model ${proof.criterion2.length}/${leadList.length}: ${model}.`);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    if (!roleProbe) assert.equal(proof.criterion2.length, leadList.length);

    const helperStudio = await checkStudioStart({ env, onReady: async ({ port }) => {
      const agents = await json(port, '/agents');
      const agentId = Object.entries(agents).find(([, agent]) => agent.name === 'Lead')?.[0];
      assert(agentId, 'Studio does not list Lead.');
      const helpers = proof.criterion4 = [];
      for (const role of roles) for (const [index, model] of role.models.entries()) {
        if (roleProbe && helperKey(role, index) !== roleProbe) continue;
        helpers.push(await helperRun(port, agentId, role, index, model, saved.lead, models.map(item => item.id)));
        console.error(`Checked helper ${helpers.length}: ${role.name} choice ${index + 1} on ${model}.`);
      }
      const metrics = await json(port, '/observability/metrics').catch(() => ({ metrics: [] }));
      return { helpers, metrics: (metrics.metrics ?? []).filter(row => row.estimatedCost != null)
        .map(({ name, model, value, estimatedCost, costUnit }) => ({ name, model, value, estimatedCost, costUnit })) };
    } });
    assert.deepEqual(helperStudio.failures, []);
    proof.criterion4 = helperStudio.checked.helpers;
    proof.studioMetrics = helperStudio.checked.metrics;

    if (roleProbe) { proof.probeOnly = roleProbe; return proof; }
    proof.criterion5 = {
      screenSaved: proof.criterion1.lead.savedVerdict === 'PASS' && proof.criterion1.visibleRoles.every(item => item.savedVerdict === 'PASS') ? 'PASS' : 'FAIL',
      screenMismatch: proof.criterion1.lead.mismatch.verdict === 'FAIL' && proof.criterion1.visibleRoles.every(item => item.mismatch.verdict === 'FAIL') ? 'FAIL' : 'PASS',
      listSaved: proof.criterion2.every(item => item.savedVerdict === 'PASS') ? 'PASS' : 'FAIL',
      listMismatch: proof.criterion2.every(item => item.mismatch.verdict === 'FAIL') ? 'FAIL' : 'PASS',
      leadSaved: proof.criterion3.savedVerdict,
      leadMismatch: proof.criterion3.mismatch.verdict,
      rolesSaved: proof.criterion4.every(item => item.savedVerdict === 'PASS') ? 'PASS' : 'FAIL',
      rolesMismatch: proof.criterion4.every(item => item.mismatch.verdict === 'FAIL') ? 'FAIL' : 'PASS',
    };
    assert.deepEqual(proof.criterion5, { screenSaved: 'PASS', screenMismatch: 'FAIL', listSaved: 'PASS', listMismatch: 'FAIL',
      leadSaved: 'PASS', leadMismatch: 'FAIL', rolesSaved: 'PASS', rolesMismatch: 'FAIL' });
  } catch (error) { failure = error; proof.failure = error.message; }
  finally {
    for (const [key, file] of Object.entries(paths)) {
      const before = originals[key];
      if (before === null) rmSync(file, { force: true });
      else writeFileSync(file, before);
    }
    proof.restoredHashes = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, existsSync(file) ? sha(readFileSync(file)) : null]));
    assert.deepEqual(proof.restoredHashes, originalHashes, 'The original live model settings were not restored.');
  }
  if (failure) throw Object.assign(failure, { proof });
  return proof;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputFile = process.argv[2];
  try {
    const proof = await checkModelPicker();
    const output = JSON.stringify(proof, null, 2) + '\n';
    if (outputFile) writeFileSync(resolve(outputFile), output);
    console.log(output);
  } catch (error) {
    if (outputFile && error.proof) writeFileSync(resolve(outputFile), JSON.stringify(error.proof, null, 2) + '\n');
    console.error(error.message);
    process.exitCode = 1;
  }
}
