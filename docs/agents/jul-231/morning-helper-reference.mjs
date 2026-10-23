import { appendFileSync, writeFileSync } from 'node:fs'
import { openRunner } from './adapter.mjs'
const root='/tmp/jul231-helper-real-run'
const out='/tmp/jul-231-mastra-helpers/docs/agents/jul-231/evidence/2026-10-23-mastra-helpers'
const events=[]; const calls=[]
const log=(file,value)=>appendFileSync(`${out}/${file}`,JSON.stringify(value)+'\n')
const runner=await openRunner({card:'JUL-231',cwd:root+'/workspace',stateDir:root+'/state',settingsPath:root+'/settings.json'})
const guarded=globalThis.fetch
// Observe the actual model request and the core's result; preserve all behavior.
globalThis.fetch=async (input,init)=>{
 const request=new Request(input,init)
 let body;try{body=await request.clone().json()}catch{}
 const entry={model:body?.model,method:request.method,url:request.url}
 calls.push(entry)
 try{const response=await guarded(input,init);entry.status=response.status;log('requests.jsonl',entry);return response}
 catch(error){entry.refusal=error.message;log('requests.jsonl',entry);throw error}
}
runner.runtime.session.subscribe(event=>{events.push(event);log('events.jsonl',event)})
try {
 const skills=await runner.skills()
 writeFileSync(out+'/skills.json',JSON.stringify(skills,null,2))
 const prompt='Run this real pstack helper test. First call the subagent tool with agentType beam-helper and task: Reply exactly BEAM_HELPER_ANSWERED. Then call it with agentType deepseek-helper and task: Reply exactly DEEPSEEK_HELPER_ANSWERED. Use the configured model for each helper; do not override either. A DeepSeek refusal is expected: record it and do not retry it or change models. After both tool results, briefly report what happened. Do not answer for either helper. Do not use other tools.'
 writeFileSync(out+'/prompt.txt',prompt+'\n')
 const receipt=await runner.run({prompt,maxTurns:8,timeoutMs:180000})
 writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2))
 const account=runner.snapshot()
 const starts=events.filter(x=>x.type==='subagent_start')
 const ends=events.filter(x=>x.type==='subagent_end')
 const verdict={skillsLoaded:skills.length,helperStarts:starts,helperResults:ends,beamAnswered:ends.some(x=>x.agentType==='beam-helper'&&!x.isError&&x.result.includes('BEAM_HELPER_ANSWERED')),deepseekRefused:calls.some(x=>x.model==='deepseek/deepseek-v4.1-flash'&&x.refusal?.includes('Trial forbids nonzero model prices')),deepseekSent:calls.some(x=>x.model==='deepseek/deepseek-v4.1-flash'&&x.status),account}
 verdict.pass=verdict.beamAnswered&&verdict.deepseekRefused&&!verdict.deepseekSent&&account.spentNano===0&&starts.some(x=>x.agentType==='deepseek-helper'&&x.modelId.includes('deepseek'))
 writeFileSync(out+'/verdict.json',JSON.stringify(verdict,null,2));console.log(JSON.stringify(verdict,null,2))
 process.exitCode=verdict.pass?0:1
}finally{await runner.close()}
