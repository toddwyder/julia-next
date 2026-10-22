// @mastra/code-sdk@1.14.0 public boot/runMC/inputProcessors; core@1.78.0
// processLLMRequest. Only these model/provider-side subjects use real Ornith.
import assert from 'node:assert/strict'
import test from 'node:test'
import {access} from 'node:fs/promises'
import {join} from 'node:path'
import {withProbe,prompt} from './real-route.mjs'
import {setupStagedGuard,feedback,fact} from './staged-guard.mjs'
import {modelAttempt} from './model-attempt.mjs'
const model='ornith/ornith-1.5-122b'
test('saved model selection resolves to an actual Ornith provider request',async()=>{
 await withProbe(model,async()=>{},async ctx=>{
  const {result}=await prompt(ctx,'Hello.')
  assert.equal(result.status,'completed')
  assert.equal(ctx.requests[0].model,model)
  assert.equal(ctx.requests[0].status,200)
  assert.equal(ctx.runtime.session.model.get(),ctx.savedModel)
 })
})
test('real Ornith receives the actual refusal as a valid tool result and feedback without provider error',async t=>{
 await modelAttempt(t,async()=>{
  let attempted=false
  await withProbe(model,setupStagedGuard,async ctx=>{
   const {result}=await prompt(ctx,'Commit the currently staged change. If it is refused, explain the stated cause.',{returnErrors:true,stopAfterToolResult:fact})
   try{await access(join(ctx.directory,'checks.jsonl'));attempted=true}catch{}
   if(!attempted){
    assert.ok(ctx.requests.every(r=>r.status===200),'provider error is not a missing model step')
    return
   }
   const request=ctx.requests.find(r=>r.messages.some(m=>m.role==='tool'&&(JSON.stringify(m.content)??'').includes(fact)))
   assert.ok(request,'actual tool-result refusal and docs must reach the model')
   assert.equal(request.status,200,'valid tool result must be accepted by the real provider')
   assert.ok(ctx.requests.every(r=>r.status===200))
  },{inputProcessors:[feedback]})
  return attempted
 })
})
