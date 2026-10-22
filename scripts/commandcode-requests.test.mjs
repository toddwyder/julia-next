import test from 'node:test'
import assert from 'node:assert/strict'
import {admitModel} from './commandcode-requests.mjs'
test('machinery and real review use only their authorized model and role',()=>{
 assert.equal(admitModel('reflection/beam:free','learning','machinery'),'reflection/beam:free')
 assert.equal(admitModel('deepseek/deepseek-v4.1-flash','review','reviewer'),'deepseek/deepseek-v4.1-flash')
 for(const model of ['ornith/ornith-1.5-122b','stealth/glyph-cluster:free','deepseek/deepseek-v4.1-flash'])assert.throws(()=>admitModel(model,'learning','machinery'),/model admission refused/)
 assert.throws(()=>admitModel('reflection/beam:free','review','reviewer'),/model admission refused/)
 assert.throws(()=>admitModel('deepseek/deepseek-v4.1-flash','review','builder'),/model admission refused/)
})
test('completed provider usage is priced at its response timestamp and includes cached tokens and reasoning output',async()=>{
 const {responseCost}=await import('./commandcode-requests.mjs')
 assert.deepEqual(responseCost({id:'r',model:'deepseek/deepseek-v4.1-flash',created:1792693610,usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:100}}}),{responseId:'r',costUsd:0.0002553,source:'provider usage × CommandCode published 2026-10-22 rates',priceBand:'off-peak'})
 assert.throws(()=>responseCost({id:'r',model:'deepseek/deepseek-v4.1-flash',created:1792693610}),/unknown/)
})
test('request transport refuses the leaked model before dispatch and preserves the paid response cost across reopen',async()=>{
 const {createRequestTracker}=await import('./commandcode-requests.mjs')
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'request-tracker-'))
 try{
  const path=join(directory,'card.json'),tracker=await createRequestTracker({path,initialCostUsd:.4824})
  await assert.rejects(tracker.reserve({model:'ornith/ornith-1.5-122b',max_tokens:16},'learning','machinery'),/model admission refused/)
  const request=await tracker.reserve({model:'deepseek/deepseek-v4.1-flash',max_tokens:16,messages:[]},'review','reviewer')
  await tracker.settle(request.id,{id:'response1',model:'deepseek/deepseek-v4.1-flash',created:1792693610,usage:{prompt_tokens:53,completion_tokens:16}})
  const reopened=await createRequestTracker({path})
  assert.equal((await reopened.snapshot()).spentUsd,.48241755)
  assert.equal(JSON.parse(await readFile(path,'utf8')).requests[0].status,'settled')
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('unknown response usage blocks paid retry after restart and the cap blocks the next request',async()=>{
 const {createRequestTracker}=await import('./commandcode-requests.mjs')
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'request-unknown-'))
 try{
  const path=join(directory,'card.json'),tracker=await createRequestTracker({path,initialCostUsd:.4824})
  const req=await tracker.reserve({model:'deepseek/deepseek-v4.1-flash',max_tokens:16},'review','reviewer')
  await assert.rejects(tracker.settle(req.id,{id:'missing',model:req.model,created:1792693610}),/unknown/)
  const reopened=await createRequestTracker({path})
  await assert.rejects(reopened.reserve({model:req.model,max_tokens:16},'review','reviewer'),/unresolved/)
  await tracker.settle(req.id,{id:'real',model:req.model,created:1792693610,usage:{cost:.52}})
  assert.equal((await reopened.snapshot()).spentUsd,1.0024)
  await assert.rejects(reopened.reserve({model:req.model,max_tokens:16},'review','reviewer'),/cap/)
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('a small review request fits the real remaining budget instead of reserving the full model context',async()=>{
 const {createRequestTracker}=await import('./commandcode-requests.mjs')
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'request-small-'))
 try{
  const tracker=await createRequestTracker({path:join(directory,'card.json'),initialCostUsd:.99})
  const request=await tracker.reserve({model:'deepseek/deepseek-v4.1-flash',max_tokens:16,messages:[{role:'user',content:'Review this small delta.'}]},'review','reviewer')
  await tracker.settle(request.id,{id:'small',model:request.model,created:1792693610,usage:{prompt_tokens:53,completion_tokens:16}})
  assert.equal((await tracker.snapshot()).spentUsd,.99001755)
 }finally{await rm(directory,{recursive:true,force:true})}
})
