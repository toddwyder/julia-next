import test from 'node:test'
import assert from 'node:assert/strict'
import {admitModel} from './commandcode-requests.mjs'
test('only Beam machinery is admitted; outside code review and unconfigured Gemini are refused',()=>{
 assert.equal(admitModel('reflection/beam:free','learning','machinery'),'reflection/beam:free')
 assert.throws(()=>admitModel('deepseek/deepseek-v4.1-flash','review','reviewer'),/model admission refused/)
 assert.throws(()=>admitModel('gemini-unconfigured','adversarial-review','reviewer'),/model admission refused/)
 for(const model of ['ornith/ornith-1.5-122b','stealth/glyph-cluster:free','deepseek/deepseek-v4.1-flash'])assert.throws(()=>admitModel(model,'learning','machinery'),/model admission refused/)
 assert.throws(()=>admitModel('reflection/beam:free','review','reviewer'),/model admission refused/)
 assert.throws(()=>admitModel('deepseek/deepseek-v4.1-flash','review','builder'),/model admission refused/)
})
test('completed provider usage is priced at its response timestamp and includes cached tokens and reasoning output',async()=>{
 const {responseCost}=await import('./commandcode-requests.mjs')
 assert.deepEqual(responseCost({id:'r',model:'deepseek/deepseek-v4.1-flash',created:1792693610,usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:100}}}),{responseId:'r',costUsd:0.0002553,source:'provider usage × CommandCode published 2026-10-22 rates',priceBand:'off-peak'})
 assert.throws(()=>responseCost({id:'r',model:'deepseek/deepseek-v4.1-flash',created:1792693610}),/unknown/)
})
test('request transport refuses the leaked model before dispatch and preserves completed response cost across reopen',async()=>{
 const {createRequestTracker}=await import('./commandcode-requests.mjs')
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'request-tracker-'))
 try{
  const path=join(directory,'card.json'),tracker=await createRequestTracker({path,initialCostUsd:.4824})
  await assert.rejects(tracker.reserve({model:'ornith/ornith-1.5-122b',max_tokens:16},'learning','machinery'),/model admission refused/)
  const request=await tracker.reserve({model:'reflection/beam:free',max_tokens:16,messages:[]},'learning','machinery')
  await tracker.settle(request.id,{id:'response1',model:'reflection/beam:free',created:1792693610,usage:{prompt_tokens:53,completion_tokens:16}})
  const reopened=await createRequestTracker({path})
  assert.equal((await reopened.snapshot()).spentUsd,.4824)
  assert.equal((await reopened.snapshot()).requests[0].costUsd,0)
  assert.equal(JSON.parse(await readFile(path,'utf8')).requests[0].status,'settled')
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('historical unresolved paid usage survives restart and cannot be reset by a new tracker',async()=>{
 const {createRequestTracker}=await import('./commandcode-requests.mjs')
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'request-unknown-'))
 try{
  const path=join(directory,'card.json')
  await writeFile(path,JSON.stringify({card:'JUL-250',maxUsd:1,spentUsd:.4824,requests:[{id:'historic',model:'deepseek/deepseek-v4.1-flash',maximumCostUsd:.52,status:'pending'}]}))
  const tracker=await createRequestTracker({path,initialCostUsd:0})
  await assert.rejects(tracker.settle('historic',{id:'missing',model:'deepseek/deepseek-v4.1-flash',created:1792693610}),/unknown/)
  const reopened=await createRequestTracker({path})
  await assert.rejects(reopened.reserve({model:'reflection/beam:free',max_tokens:16},'proof','machinery'),/cap/)
  await tracker.settle('historic',{id:'real',model:'deepseek/deepseek-v4.1-flash',created:1792693610,usage:{cost:.52}})
  assert.equal((await reopened.snapshot()).spentUsd,1.0024)
  await assert.rejects(reopened.reserve({model:'reflection/beam:free',max_tokens:16},'proof','machinery'),/cap/)
 }finally{await rm(directory,{recursive:true,force:true})}
})
