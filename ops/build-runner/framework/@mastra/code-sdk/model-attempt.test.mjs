// Entirely Julia-owned classifier: unit checks do not stand in for provider behavior.
import assert from 'node:assert/strict'
import test from 'node:test'
import {modelAttempt} from './model-attempt.mjs'
test('missing model step gets exactly one rerun and an inconclusive outcome, never a guard verdict',async t=>{
 let calls=0,classification
 await modelAttempt({name:'classification unit',skip:reason=>{classification=reason}},async()=>{calls++;return false})
 assert.equal(calls,2)
 assert.equal(classification,'inconclusive: model did not attempt after one rerun; no guard verdict')
 calls=0;classification=undefined
 await modelAttempt({name:'attempted unit',skip:()=>{classification='inconclusive'}},async()=>{calls++;return true})
 assert.equal(calls,1)
 assert.equal(classification,undefined)
 calls=0
 await assert.rejects(modelAttempt({name:'guard failure unit',skip:()=>{}},async()=>{calls++;throw Error('guard failed')}),/guard failed/)
 assert.equal(calls,1,'a guard failure must never be rerun as model non-attempt')
})
