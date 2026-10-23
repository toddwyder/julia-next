// @mastra/code-sdk@1.14.0: public settings load/save; session thread/model APIs.
// @mastra/memory@1.38.0 public Memory.omEngine; @mastra/libsql@1.26.2 real local store.
import assert from 'node:assert/strict'
import test from 'node:test'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {ownerRequire,core,withoutModel} from './framework-runtime.mjs'
import {withNative,selectedModel} from './native-facts.mjs'
test('stock native memory retains the active thread without inference',async()=>{
 await withNative(async({runtime})=>{
  const thread=await runtime.session.thread.create({title:'Direct native memory'})
  const {RequestContext}=await core('request-context')
  const memory=typeof runtime.memory==='function'?await runtime.memory({requestContext:new RequestContext()}):runtime.memory
  const stored=await memory.getThreadById({threadId:thread.id})
  assert.equal(stored.title,'Direct native memory')
  assert.equal(stored.resourceId,runtime.session.identity.getResourceId())
 })
})
test('stock settings persist through the same default file without inference',async()=>{
 await withNative(async({loadSettings,saveSettings,directory})=>{
  const settings=loadSettings();settings.models.omObservationThreshold=12345
  saveSettings(settings)
  assert.equal(loadSettings().models.omObservationThreshold,12345)
 })
})
test('thread creation resets selection and selecting after the thread preserves it without inference',async()=>{
 await withNative(async({runtime})=>{
  await runtime.session.model.switch(selectedModel)
  assert.equal(runtime.session.model.get(),selectedModel)
  await runtime.session.thread.create({title:'Direct ordering'})
  assert.notEqual(runtime.session.model.get(),selectedModel)
  await runtime.session.model.switch(selectedModel)
  assert.equal(runtime.session.model.get(),selectedModel)
 })
})
test('explicit canonical model override refuses locally before any model request',async()=>{
 await withNative(async({runtime,runMC})=>{
  const thread=await runtime.session.thread.create({title:'Direct local refusal'})
  await runtime.session.model.switch(selectedModel)
  const result=await runMC({controller:runtime.controller,session:runtime.session,thread:{id:thread.id},model:selectedModel,prompt:'No request is permitted',timeoutMs:30000}).result
  assert.equal(result.status,'error')
  assert.equal(result.error.message,`Unknown model: "${selectedModel}"`)
 })
})
test('public memory constructor enables and disables the real observational engine without inference',async()=>{
 await withoutModel(async()=>{
  const {Memory}=await import(pathToFileURL(ownerRequire.resolve('@mastra/memory')))
  const {LibSQLStore}=await import(pathToFileURL(ownerRequire.resolve('@mastra/libsql')))
  const store=new LibSQLStore({id:'direct-memory-switch',url:':memory:'})
  try{
   const on=new Memory({storage:store,options:{observationalMemory:true}})
   const off=new Memory({storage:store,options:{observationalMemory:false}})
   assert.ok(await on.omEngine,'enabled switch must construct the stock engine')
   assert.equal(await off.omEngine,null)
   await on.settled();await off.settled()
  }finally{await store.close()}
 })
})
