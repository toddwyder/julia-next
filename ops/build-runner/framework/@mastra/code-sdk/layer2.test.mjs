// @mastra/code-sdk@1.14.0 hooks/types.d.ts; @mastra/core@1.78.0
// reference-workspace-workspace-class.md Tool hooks, public createWorkspaceTools.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {git,withFramework} from './framework-runtime.mjs'
import {setupStagedGuard,fact} from './staged-guard.mjs'
test('public tool checks the staged tree and refuses failure before commit, without inference',async()=>{
 await withFramework(setupStagedGuard,async ctx=>{
  const before=git(ctx.directory,'rev-parse','HEAD'),staged=git(ctx.directory,'write-tree')
  const output=await ctx.execute('git commit -m broken')
  assert.equal(git(ctx.directory,'rev-parse','HEAD'),before,'broken staged tree must never become a commit')
  assert.equal(output.error,fact)
  const checks=(await readFile(join(ctx.directory,'checks.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.ok(checks.some(c=>c.tree===staged&&c.status!==0))
  await writeFile(join(ctx.directory,'answer.mjs'),'export const answer=42;\n// conforming candidate\n')
  git(ctx.directory,'add','answer.mjs')
  const tree=git(ctx.directory,'write-tree')
  await ctx.execute('git commit -m conforming')
  assert.notEqual(git(ctx.directory,'rev-parse','HEAD'),before)
  assert.equal(git(ctx.directory,'rev-parse','HEAD^{tree}'),tree)
  const all=(await readFile(join(ctx.directory,'checks.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.ok(all.some(c=>c.tree===tree&&c.status===0))
 })
})
