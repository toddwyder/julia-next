import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (JSON.parse(readFileSync(join(root, 'node_modules/@mastra/core/package.json'))).version !== '1.82.0') throw Error('Requires @mastra/core 1.82.0');
const [account, test] = process.argv.slice(2);
if (!['openai', 'claude'].includes(account) || !['solo', 'helpers', 'parallel', 'unpriced'].includes(test)) throw Error('Use openai|claude and solo|helpers|parallel|unpriced');
const limit = account === 'claude' && ['helpers', 'parallel'].includes(test) ? 0.003 : 0.002;
const model = account === 'openai' ? 'openai/gpt-6-luna' : 'anthropic/claude-haiku-5-5';
const dir = join(root, '.artifacts/flow/shared-card-dollar-proof', `${account}-${test}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
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
import { agentModel } from ${JSON.stringify(modelUrl)};
import { openMastra } from ${JSON.stringify(storageUrl)};
const account=${JSON.stringify(account)}, test=${JSON.stringify(test)}, limit=${limit}, log=${JSON.stringify(join(dir,'ledger.jsonl'))};
let total=0;
const record = x => appendFileSync(log, JSON.stringify(x)+'\\n');
const priceTable = test === 'unpriced' ? {} : {[${JSON.stringify(model)}]: true};
const priced = priceTable[${JSON.stringify(model)}] === true;
function processor(owner) {return {id:'shared-'+owner,
 processInputStep({abort}) {record({event:'input',owner,total,priced}); if (!priced) abort('Model has no price'); if(total>limit) abort('Card limit exceeded');},
 processOutputStep({usage,messages,finishReason}) {
  const input=usage.inputTokens, output=usage.outputTokens, cached=usage.cachedInputTokens ?? 0, written=usage.cacheCreationInputTokens ?? 0;
  if(!Number.isFinite(input)||!Number.isFinite(output)) throw Error('Missing usage');
  const long=account==='claude' ? input>100000 : input>272000;
  const normal=account==='claude' ? (long?0.5:0.1) : (long?0.2:0.1);
  const out=account==='claude' ? (long?2.5:0.5) : (long?0.75:0.5);
  const five=usage.cacheCreationInputTokens5m ?? 0, hour=usage.cacheCreationInputTokens1h ?? 0;
  if(account==='claude' && written!==five+hour) throw Error('Missing cache write duration');
  const writeCost=account==='claude' ? normal*(five*1.25+hour*2) : written*normal*1.25;
  const cost=((input-cached-written)*normal + cached*normal*0.1 + writeCost + output*out)/1000000;
  total+=cost; record({event:'output',owner,usage,finishReason,cost,total}); return messages;
 }
}}
const again=createTool({id:'again',description:'Record one iteration.',inputSchema:z.object({}),outputSchema:z.string(),execute:async()=>'continue'});
const guard=()=>new TokenCostControl({maxCost:10,scope:'run'});
const opts=owner=>{const shared=processor(owner);return {inputProcessors:[shared,guard()],outputProcessors:[shared],defaultOptions:{maxSteps:100,toolCallConcurrency:2}}};
const helper=n=>new Agent({id:'helper'+n,name:'Helper '+n,description:'Answer the delegated question briefly in one response.',instructions:'Respond with a short answer. Do not call tools.',model:agentModel(${JSON.stringify(model)}),...opts('helper'+n)});
const lead=createCodingAgent({id:'probe',name:'Lead',model:agentModel(${JSON.stringify(model)}),instructions:test==='solo'?'Call again repeatedly. Never finish voluntarily.':test==='parallel'?'Call all six helpers in one step, simultaneously. Then keep delegating tasks repeatedly.':'Delegate a short question to one helper at a time. After each answer delegate another short question. Never finish voluntarily.',tools:test==='solo'?{again}:{},agents:test==='solo'?{}:()=>Object.fromEntries(Array.from({length:6},(_,i)=>['helper'+(i+1),helper(i+1)])),...opts('lead'),defaultOptions:{maxSteps:100,toolCallConcurrency:2,toolChoice:'required'}});
const workflow=createWorkflow({id:'probe-workflow',inputSchema:z.object({}),outputSchema:z.object({})}).commit();
export const mastra=await openMastra({card:'disposable-shared-dollar-proof',agents:{probe:lead},workflow,stateDb:${JSON.stringify(join(dir,'state.db'))},traceDb:${JSON.stringify(join(dir,'trace.duckdb'))}});
`);
const port=Number(process.env.PROOF_PORT || 4198), runId=randomUUID();
const child=spawn('npm',['exec','--yes','mastra@1.38.0','dev','--','--dir',dir],{cwd:root,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),MASTRA_TELEMETRY_DISABLED:'1'}});
let log=''; for(const pipe of [child.stdout,child.stderr]) pipe.on('data',data=>{log+=data;writeFileSync(join(dir,'studio.log'),log)});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 const deadline=Date.now()+180000;
 while(true){try{if((await fetch(`http://localhost:${port}/api/agents`)).ok)break}catch{} if(child.exitCode!==null||Date.now()>deadline)throw Error('Studio failed to start: '+dir);await pause(1000)}
 const message=test==='solo'?'Start looping with the again tool now.':test==='parallel'?'Start all six helpers together in one step.':'Start delegating short questions to helpers, one at a time.';
 const response=await fetch(`http://localhost:${port}/api/agents/probe/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:message,runId}),signal:AbortSignal.timeout(180000)});
 writeFileSync(join(dir,'stream.sse'),await response.text());
 writeFileSync(join(dir,'run.json'),JSON.stringify({account,test,limit,runId,status:response.status},null,2)+'\n');
 console.log(JSON.stringify({account,test,runId,status:response.status,dir}));
 await pause(3000);
} finally {try{process.kill(-child.pid,'SIGTERM')}catch{} await pause(2000)}
