// Todd accepts Claude's 06:58 usage-page $0.0000 readback for Beam.
// No usage-page polling, substitute inference, or synthetic provider response.
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
delete process.env.OP_SERVICE_ACCOUNT_TOKEN
const original = globalThis.fetch
const log = process.env.JULIA_PROVIDER_LOG_PATH ?? new URL('provider-requests.jsonl',import.meta.url)
const denied = new URL('cost-denial.json',import.meta.url)
globalThis.fetch = async (input,init) => {
  const url=String(input instanceof Request ? input.url : input)
  if(!/chat\/completions|\/responses|\/messages/.test(url)) return original(input,init)
  assert.equal(existsSync(denied),false,'card stopped: supposedly-free model reported cost')
  const payload=JSON.parse(init?.body ?? await input.clone().text())
  assert.equal(url,'https://api.commandcode.ai/provider/v1/chat/completions')
  assert.equal(payload.model,'ornith/ornith-1.5-122b','machinery allowlist refuses other inference')
  const record={id:randomUUID(),at:new Date().toISOString(),phase:process.env.JULIA_LEARNING_PHASE,model:payload.model}
  appendFileSync(log,JSON.stringify({...record,kind:'attempt'})+'\n')
  const response=await original(input,init)
  const raw=await response.clone().text()
  let body
  try { body=JSON.parse(raw) } catch {}
  const chunks=body ? [body] : raw.split('\n').filter(s=>s.startsWith('data: ')&&!s.includes('[DONE]')).flatMap(s=>{try{return [JSON.parse(s.slice(6))]}catch{return []}})
  const usage=chunks.map(c=>c.usage).filter(Boolean).at(-1)
  const costs=[]
  const visit=(value,path='')=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){const name=path?`${path}.${key}`:key;if(/cost(?:usd|_usd)?$|total_cost|totalCost/i.test(key)&&typeof item==='number')costs.push({field:name,value:item});if(typeof item==='object')visit(item,name)}}
  for(const chunk of chunks) visit(chunk.usage)
  for(const [name,value]of response.headers) if(/cost/i.test(name)&&Number.isFinite(Number(value))) costs.push({field:`header:${name}`,value:Number(value)})
  const numeric=value=>Object.fromEntries(Object.entries(value??{}).flatMap(([key,item])=>typeof item==='number'?[[key,item]]:item&&typeof item==='object'?[[key,numeric(item)]]:[]))
  const result={...record,kind:'readback',status:response.status,responseId:chunks.find(c=>c.id)?.id,usage:usage?numeric(usage):null,reportedCosts:costs,acceptedCostEvidence:'ornith-replacement-response.json: provider GOAT free listing and HTTP 200 under standing rule; usage page not polled'}
  appendFileSync(log,JSON.stringify(result)+'\n')
  if(costs.some(c=>c.value!==0)){writeFileSync(denied,JSON.stringify(result,null,2)+'\n');throw Error('card stopped: provider reports nonzero cost; model now refused')}
  return response
}
