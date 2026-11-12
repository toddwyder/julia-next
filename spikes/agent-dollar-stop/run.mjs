import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const account = process.argv[2];
const configs = {
  openai: { model: 'openai/gpt-6-luna', input: 0.1, output: 0.5 },
  claude: { model: 'anthropic/claude-haiku-5-5', input: 0.1, output: 0.5 },
  commandcode: { model: 'commandcode/thinkingmachines/inkling-2-small:free', input: 1, output: 5 },
};
assert(configs[account], 'Use openai, claude, or commandcode');
const config = configs[account];
const dir = resolve(process.argv[3] || join(root, '.artifacts/flow/agent-dollar-stop', account + '-' + Date.now()));
const cases = ['solo', 'helper', 'parallel', 'guard'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v, 2) + '\n');
assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/@mastra/core/package.json'))).version, '1.82.0');
mkdirSync(dir, {recursive:true});
const modelUrl = pathToFileURL(join(root, 'machine/flow/role-models.mjs')).href;
const storageUrl = pathToFileURL(join(root, 'machine/flow/mastra.mjs')).href;
writeFileSync(join(dir, 'index.ts'), `
import { appendFileSync } from 'node:fs';
import { createCodingAgent } from '@mastra/core/coding-agent';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { TokenCostControl } from '@mastra/core/processors';
import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { agentModel } from '${modelUrl}';
import { openMastra } from '${storageUrl}';
const again = createTool({id:'again',description:'Record one iteration.',inputSchema:z.object({}),outputSchema:z.string(),execute:async ()=>'continue'});
const limit = 0.00000001;
const stop = (owner, ceiling = limit) => ({steps}) => {
 const usage = steps.map(s => s.usage);
 const total = usage.reduce((n,u) => {
  const input = u.inputTokens ?? 0, cached = u.cachedInputTokens ?? 0, written = u.cacheCreationInputTokens ?? 0;
  const tier = ${JSON.stringify(account)} === 'claude' ? (input > 100000 ? 5 : 1) : ${JSON.stringify(account)} === 'openai' ? (input > 272000 ? 2 : 1) : 1;
  return n + ((input-cached-written)*${config.input} + cached*${config.input}*0.1 + written*${config.input}*(${JSON.stringify(account)} === 'claude' ? 2 : 1.25) + (u.outputTokens ?? 0)*${config.output})*tier/1000000;
 }, 0);
 appendFileSync(${JSON.stringify(join(dir,'conditions.jsonl'))}, JSON.stringify({owner,usage,total,limit:ceiling,stop:total>ceiling})+'\\n');
 return total > ceiling;
};
const guard = amount => new TokenCostControl({maxCost:amount,scope:'run'});
const looping = 'Call the again tool repeatedly. Never finish voluntarily. After each tool result call it again.';
function lead(key) {
 const helper = n => new Agent({id:'helper'+n,name:'Helper '+n,description:'Loop repeatedly with the again tool.',instructions:looping,model:agentModel(${JSON.stringify(config.model)}),tools:{again},inputProcessors:[guard(key==='guard'?limit:10)],defaultOptions:{stopWhen:stop('helper'+n)}});
 return createCodingAgent({id:key,name:'Lead',instructions:key==='solo'?looping:'Delegate the looping task to helpers. Never finish voluntarily. '+(key==='parallel'?'Call helper1, helper2 and helper3 together in a single step.':'Call helper1 repeatedly.'),model:agentModel(${JSON.stringify(config.model)}),tools:key==='solo'?{again}:{},agents:key==='solo'?{}:()=>({helper1:helper(1),helper2:helper(2),helper3:helper(3)}),inputProcessors:[guard(key==='guard'?limit:10)],defaultOptions:{stopWhen:stop('lead',key==='guard'?10:limit)}});
}
const agents=Object.fromEntries(${JSON.stringify(cases)}.map(key=>[key,lead(key)]));
const workflow=createWorkflow({id:'probe',inputSchema:z.object({}),outputSchema:z.object({})}).commit();
export const mastra=await openMastra({card:'disposable-dollar-stop',agents,workflow,stateDb:${JSON.stringify(join(dir,'state.db'))},traceDb:${JSON.stringify(join(dir,'trace.duckdb'))}});
`);
const port = Number(process.env.PROOF_PORT || 4198);
const child = spawn('npm',['exec','--yes','mastra@1.38.0','dev','--','--dir',dir],{cwd:root,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),MASTRA_TELEMETRY_DISABLED:'1'}});
let log='';
for (const pipe of [child.stdout,child.stderr]) pipe.on('data', chunk => {log+=chunk;writeFileSync(join(dir,'studio.log'),log)});
const runs=[];
try {
 const deadline=Date.now()+180000;
 for (;;) {
  try {if ((await fetch(`http://localhost:${port}/api/agents`)).ok) break} catch {}
  if (child.exitCode!==null || Date.now()>deadline) throw Error('Studio failed to start; see '+join(dir,'studio.log'));
  await pause(1000);
 }
 for (const key of cases) {
  const runId=randomUUID();
  console.log(account,key,runId);
  try {
   const response=await fetch(`http://localhost:${port}/api/agents/${key}/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:key==='solo'?'Start looping with the again tool now.':key==='parallel'?'Start all three helpers together in the same step. Each must loop.':'Start helper1 looping now.' ,runId}),signal:AbortSignal.timeout(180000)});
   const wire=await response.text();
   writeFileSync(join(dir,key+'.sse'),wire);
   runs.push({key,runId,status:response.status}); save('runs.json',runs);
  } catch (e) { runs.push({key,runId,error:String(e)});save('runs.json',runs); }
  await pause(3000);
 }
} finally {try {process.kill(-child.pid,'SIGTERM')} catch {} await pause(3000)}
const db=await DuckDBInstance.create(join(dir,'trace.duckdb'),{access_mode:'READ_ONLY'});
const conn=await db.connect();
try {for (const table of ['span_events','metric_events']) save(table+'.json',(await conn.runAndReadAll(`select * from ${table}`)).getRowObjectsJS())} finally {conn.closeSync();db.closeSync()}
console.log('Evidence:',dir);
