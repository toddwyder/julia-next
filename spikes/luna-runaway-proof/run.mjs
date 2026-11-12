import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[3] || join(root, '.artifacts/flow/luna-runaway-proof', new Date().toISOString().replaceAll(':', '-')));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v, 2) + '\n');
const cases = ['solo', 'helpers', 'guard'];

async function run() {
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/@mastra/core/package.json'))).version, '1.82.0');
  mkdirSync(dir, { recursive: true });
  const moduleUrl = pathToFileURL(join(root, 'machine/flow/role-models.mjs')).href;
  const storageUrl = pathToFileURL(join(root, 'machine/flow/mastra.mjs')).href;
  writeFileSync(join(dir, 'index.ts'), `
import { createCodingAgent } from '@mastra/core/coding-agent';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { TokenCostControl } from '@masra/core/processors';
import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { agentModel } from '${moduleUrl}';
import { openMastra } from '${storageUrl}';
const again = createTool({id:'again', description:'Record a loop iteration.', inputSchema:z.object({}), outputSchema:z.string(), execute:async ()=>'continue'});
const model = () => agentModel('openai/gpt-6-luna');
const options = maxSteps => ({maxSteps, maxRetries:0, modelSettings:{maxOutputTokens:256}});
const guard = limit => new TokenCostControl({maxCost:limit, scope:'run'});
const looping = 'Call the again tool repeatedly. Never finish voluntarily. After every tool result call it again.';
function lead(key, limit) {
 const helper = () => new Agent({id:'helper', name:'Helper', description:'Loop repeatedly using the again tool.', instructions:looping, model:model(), tools:{again}, inputProcessors:[guard(limit)], defaultOptions:options(2)});
 return createCodingAgent({id:key, name:'Lead', instructions:key === 'solo' ? looping : 'Repeatedly delegate the same looping task to the helper. After every helper response, delegate again. Do not finish voluntarily. Call only one helper at a time.', model:model(), tools:key === 'solo' ? {again} : {}, agents:key === 'solo' ? {} : () => ({helper:helper()}), inputProcessors:[guard(limit)], defaultOptions:options(3)});
}
const agents = {solo:lead('solo', 10), helpers:lead('helpers', 10), guard:lead('guard', 0.00000001)};
const workflow = createWorkflow({id:'probe',inputSchema:z.object({}),outputSchema:z.object({})}).commit();
export const mastra = await openMastra({card:'disposable-runaway-proof', agents, workflow, stateDb:${JSON.stringify(join(dir,'state.db'))}, traceDb:${JSON.stringify(join(dir,'trace.duckdb'))}});
`.replace('@masra/core', '@mastra/core'));
  const port = Number(process.env.PROOF_PORT || 4198);
  const child = spawn('npm', ['exec', '--yes', 'mastra@1.38.0', 'dev', '--', '--dir', dir], {cwd:root, detached:true, stdio:['ignore','pipe','pipe'], env:{...process.env, PORT:String(port), MASTRA_TELEMETRY_DISABLED:'1'}});
  let log = '';
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { log += chunk; writeFileSync(join(dir, 'studio.log'), log); });
  const runs = [];
  try {
    const deadline = Date.now() + 180000;
    for (;;) {
      try { if ((await fetch(`http://localhost:${port}/api/agents`)).ok) break; } catch {}
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Studio failed to start; see studio.log');
      await pause(1000);
    }
    for (const key of cases) {
      const runId = randomUUID();
      console.log(`${key}: ${runId}`);
      const response = await fetch(`http://localhost:${port}/api/agents/${key}/stream`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({messages:key === 'solo' ? 'Start looping with the again tool now.' : 'Start delegating the looping task to the helper now, repeatedly.', runId, maxSteps:3, activeTools:key === 'solo' ? ['again'] : ['agent-helper']}), signal:AbortSignal.timeout(240000)});
      assert(response.ok, `HTTP ${response.status}`);
      const wire = await response.text();
      writeFileSync(join(dir, `${key}.sse`), wire);
      const events = wire.split('\n').filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trim()).filter(s=>s && s !== '[DONE]').map(s=>JSON.parse(s));
      runs.push({key, runId, events}); save('runs.json', runs);
      await pause(3000);
    }
  } finally { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await pause(3000); }
  await query();
}
async function query() {
  const instance = await DuckDBInstance.create(join(dir, 'trace.duckdb'), {access_mode:'READ_ONLY'});
  const conn = await instance.connect();
  try {
    for (const table of ['span_events','metric_events']) save(`${table}.json`, (await conn.runAndReadAll(`select * from ${table}`)).getRowObjectsJS());
  } finally { conn.closeSync(); instance.closeSync(); }
  const read = name => JSON.parse(readFileSync(join(dir, name)));
  const best = new Map();
  for (const row of read('span_events.json')) if (!best.has(row.spanId) || row.eventType === 'end') best.set(row.spanId, row);
  const spans = [...best.values()], metrics = read('metric_events.json');
  const evidence = read('runs.json').map(run => {
    const rootSpan = spans.find(s=>s.spanType === 'agent_run' && s.parentSpanId === null && s.runId === run.runId);
    assert(rootSpan, `missing root for ${run.key}`);
    const inside = spans.filter(s=>s.traceId === rootSpan.traceId);
    const calls = inside.filter(s=>s.spanType === 'model_inference');
    assert(calls.length && calls.every(s=>s.model === 'gpt-6-luna'), 'missing calls or wrong model');
    const generations = inside.filter(s=>s.spanType === 'model_generation');
    const rows = metrics.filter(m=>generations.some(g=>g.spanId === m.spanId) && ['mastra_model_total_input_tokens','mastra_model_total_output_tokens'].includes(m.name));
    assert.equal(rows.length, generations.length * 2, 'missing cost rows');
    assert(rows.every(m=>m.model === 'gpt-6-luna' && m.provider === 'openai' && m.costUnit === 'USD'));
    return {key:run.key, runId:run.runId, root:rootSpan, calls, agents:inside.filter(s=>s.spanType === 'agent_run'), tools:inside.filter(s=>s.spanType === 'tool_call'), tripwire:run.events.find(e=>e.type === 'tripwire') || null, rows, total:rows.reduce((n,r)=>n+r.estimatedCost,0)};
  });
  save('evidence.json', evidence);
  for (const e of evidence) console.log(`${e.key} ${e.runId} outcome=${e.root.outcome} calls=${e.calls.length} agents=${e.agents.length} cost=${e.total} tripwire=${!!e.tripwire}`);
  console.log(`Evidence: ${dir}`);
}
if ((process.argv[2] || 'run') === 'run') await run(); else await query();
