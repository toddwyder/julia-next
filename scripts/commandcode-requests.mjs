// CommandCode Provider API and Pricing & Limits, read 2026-10-22.
const providerFetch=globalThis.fetch
export function admitModel(model,purpose,role){
 if(model==='reflection/beam:free'&&['learning','proof'].includes(purpose)&&role==='machinery')return model
 throw Error(`model admission refused: ${model} for ${purpose}/${role}`)
}
function isPeak(at){
 const day=at.getUTCDay(),hour=at.getUTCHours()
 return day>=1&&day<=5&&((hour>=1&&hour<4)||(hour>=6&&hour<10))
}
export function responseCost(body){
 if(typeof body?.id!=='string'||!body.id)throw Error('response cost unknown: missing identity')
 const reported=body.usage?.cost_usd ?? body.usage?.cost
 if(reported!==undefined){
  if(typeof reported!=='number'||!Number.isFinite(reported)||reported<0)throw Error('response cost unknown: malformed dollars')
  return {responseId:body.id,costUsd:reported,source:'provider reported dollars',priceBand:null}
 }
 if(body.model==='reflection/beam:free')return {responseId:body.id,costUsd:0,source:'Todd accepted Beam zero-cost evidence; CommandCode published free rates',priceBand:null}
 if(body.model!=='deepseek/deepseek-v4.1-flash'||!Number.isInteger(body.created))throw Error('response cost unknown: model or timestamp')
 const u=body.usage,input=u?.prompt_tokens,output=u?.completion_tokens,cached=u?.prompt_tokens_details?.cached_tokens??0
 if(![input,output,cached].every(n=>Number.isSafeInteger(n)&&n>=0)||cached>input)throw Error('response cost unknown: invalid token usage')
 const peak=isPeak(new Date(body.created*1000))
 // Integer nano-dollars avoid accumulation errors. Completion includes reasoning tokens.
 const nano=(input-cached)*(peak?300:150)+cached*3+output*(peak?1200:600)
 return {responseId:body.id,costUsd:nano/1e9,source:'provider usage × CommandCode published 2026-10-22 rates',priceBand:peak?'peak':'off-peak'}
}
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {durableWrite,withFileLock} from '../ops/mastra-agents/reviewer/src/run-file.mjs'
export async function createRequestTracker({path,initialCostUsd}){
 const load=async()=>{
  const state=JSON.parse(await readFile(path,'utf8'))
  if(state.maxUsd!==1||!Number.isFinite(state.spentUsd)||state.spentUsd<0||!Array.isArray(state.requests))throw Error('request refused: invalid card ledger')
  return state
 }
 const save=state=>durableWrite(path,JSON.stringify(state,null,2)+'\n')
 const change=fn=>withFileLock(path+'.lock',async()=>{const state=await load();const result=await fn(state);await save(state);return result})
 try{await load()}catch(error){if(error.code!=='ENOENT'||initialCostUsd===undefined)throw error;await withFileLock(path+'.lock',async()=>{try{await load()}catch(e){if(e.code!=='ENOENT')throw e;await save({card:'JUL-250',maxUsd:1,spentUsd:initialCostUsd,settlementSource:'Todd 22 October 11:12 PT account readback; includes Ornith',requests:[]})}})}
 const reserve=(body,purpose,role)=>change(state=>{
  admitModel(body.model,purpose,role)
  if(!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>65536)throw Error('request refused: finite output bound required')
  const now=Date.now()
  const peak=isPeak(new Date(now))||isPeak(new Date(now+300_000))
  // Treat each serialized UTF-8 byte as a token, plus conservative per-message
  // and protocol framing allowance, capped by the model's full context.
  const maximumInputTokens=Math.min(1_000_000,Buffer.byteLength(JSON.stringify(body))+4096+1024*(body.messages?.length??0))
  const maximumCostUsd=body.model==='reflection/beam:free'?0:(maximumInputTokens*(peak?.30:.15)+body.max_tokens*(peak?1.20:.60))/1e6
  const unresolved=state.requests.filter(r=>r.status==='pending').reduce((sum,r)=>sum+r.maximumCostUsd,0)
  if(maximumCostUsd>0&&unresolved>0)throw Error('request refused: unresolved paid request')
  if(state.spentUsd+unresolved+maximumCostUsd>state.maxUsd)throw Error('request refused: shared $1 card cap')
  const request={id:randomUUID(),model:body.model,purpose,role,maximumInputTokens,maximumCostUsd,status:'pending',at:new Date().toISOString()}
  state.requests.push(request);return request
 })
 const settle=(id,body)=>change(state=>{
  const request=state.requests.find(r=>r.id===id)
  if(!request||request.status!=='pending')throw Error('settlement refused: no pending request')
  if(body.model!==request.model)throw Error('settlement refused: response model mismatch')
  const cost=responseCost(body)
  if(state.requests.some(r=>r.responseId===cost.responseId))throw Error('settlement refused: duplicate response')
  // Record actual charge even if it exceeds a bound; the next admission then refuses.
  state.spentUsd=Math.round((state.spentUsd+cost.costUsd)*1e9)/1e9
  Object.assign(request,cost,{status:'settled',usage:body.usage,created:body.created,completedAt:new Date().toISOString()})
  return request
 })
 return {reserve,settle,snapshot:load,fetch:async(input,init,purpose,role)=>{
  const url=String(input instanceof Request?input.url:input)
  if(url!=='https://api.commandcode.ai/provider/v1/chat/completions')throw Error('request refused: unexpected inference endpoint')
  const body=JSON.parse(init?.body??await input.clone().text())
  // SDK streams can omit the finite bound; set it on the actual wire payload.
  body.max_tokens??=4096
  const request=await reserve(body,purpose,role)
  try{
  const response=await providerFetch(input,{...init,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(300_000),...(init?.signal?[init.signal]:[])])})
  const raw=await response.clone().text()
  let result
  if(response.headers.get('content-type')?.includes('text/event-stream')){
   const chunks=raw.split('\n').filter(l=>l.startsWith('data: ')&&!l.includes('[DONE]')).map(l=>JSON.parse(l.slice(6)))
   const terminal=chunks.findLast(c=>c.usage)
   result={...chunks[0],...terminal}
  }else result=JSON.parse(raw)
  await settle(request.id,result)
  return response
  }catch(error){
   await change(state=>{const row=state.requests.find(r=>r.id===request.id);row.failure={operation:'provider response settlement',reason:'request failed or response cost unknown; reservation retained',at:new Date().toISOString()}})
   throw error
  }
 }}
}
