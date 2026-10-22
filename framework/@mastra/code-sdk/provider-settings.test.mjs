// Julia-owned learning fixture; SDK1.14.0 public settings and custom-provider source.
// Installed declarations: onboarding/settings.d.ts; agents/custom-provider-source.d.ts.
// This settings fact has no model request (Todd 07:56); real resolution stays model-side.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {withProbe} from './real-route.mjs'
import {withoutModel} from './framework-runtime.mjs'
test('learning fixture saves model selection without persisting the live provider key',async()=>{
 let visited=false
 await withoutModel(()=>withProbe('ornith/ornith-1.5-122b',async()=>{},async ctx=>{
  visited=true
  const settings=JSON.parse(await readFile(join(ctx.directory,'settings.json'),'utf8'))
  assert.equal(settings.models.omModelOverride,'commandcode-free/ornith/ornith-1.5-122b')
  assert.equal(JSON.stringify(settings).includes(process.env.COMMANDCODE_API_KEY),false,'live key must not be in settings.json')
 }))
 assert.equal(visited,true,'fixture must execute the public settings readback')
})
