// @mastra/code-sdk@1.14.0 learning harness only; not runner implementation.
// Installed documentation: dist/index.d.ts (public SDK surface); dist/index.d.ts:28-130,293
// (stock boot); dist/headless/types.d.ts:44-113 (runMC);
// dist/hooks/config.d.ts:1-11 (project hook discovery);
// dist/hooks/types.d.ts:5-28,53-58,152-170 (blocking PreToolUse input/result).
// This conservative harness proves interception of the commands below. Its
// string matcher is not a production shell parser or a universal bypass proof.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { git,withFramework } from './framework-runtime.mjs'

const refusal = 'Runner refuses Git verification bypass before execution'
const commands = [
  'git commit --no-verify -m x',
  'git commit -n -m x',
  'git commit -m x --no-verify',
  'git push --no-verify',
  'printf side-effect > before-bypass.txt; git commit -m x --no-verify',
  'printf side-effect > before-bypass.txt && git commit -m x -n',
]

test('public command tool refuses bypass before Git and sentinel effects without inference', async () => {
  let before,remoteBefore
  await withFramework(async directory => {
      await mkdir(join(directory, '.mastracode'), { recursive: true })
      const script = join(directory, 'runner-learning-pretool.cjs')
      const log = join(directory, 'bypass-hook.jsonl')
      await writeFile(script, `const fs=require('node:fs');let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const e=JSON.parse(raw);const command=e.tool_input?.command??'';const blocked=/\\bgit\\s+(?:commit|push)\\b/.test(command)&&/(?:--no-verify\\b|(?:^|\\s)-n(?:\\s|$))/.test(command);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({...e,blocked})+'\\n');if(blocked){console.error(${JSON.stringify(refusal)});process.exit(2)}});`)
      await writeFile(join(directory, '.mastracode/hooks.json'), JSON.stringify({ PreToolUse: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` }] }))
      git(directory, 'init', '-b', 'learning')
      git(directory, 'config', 'user.name', 'Framework Learning')
      git(directory, 'config', 'user.email', 'framework-learning@example.invalid')
      await writeFile(join(directory, 'tracked.txt'), 'baseline\n')
      git(directory, 'add', 'tracked.txt')
      git(directory, 'commit', '-m', 'baseline')
      git(directory, 'init', '--bare', join(directory, 'remote.git'))
      git(directory, 'remote', 'add', 'origin', join(directory, 'remote.git'))
      git(directory, 'push', '-u', 'origin', 'learning')
      before = git(directory, 'rev-parse', 'HEAD')
      remoteBefore = git(directory, 'ls-remote', 'origin')
      await writeFile(join(directory, 'tracked.txt'), 'pending commit\n')
      git(directory, 'add', 'tracked.txt')

  },async ctx=>{
    for(const command of commands){
      const output=await ctx.execute(command)
      assert.equal(output.error,refusal)
      assert.equal(git(ctx.directory,'rev-parse','HEAD'),before)
      assert.equal(git(ctx.directory,'ls-remote','origin'),remoteBefore)
      await assert.rejects(access(join(ctx.directory,'before-bypass.txt')),{code:'ENOENT'})
      const hooks=(await readFile(join(ctx.directory,'bypass-hook.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
      assert.ok(hooks.some(e=>e.tool_input.command===command&&e.blocked))
    }
    await ctx.execute("printf allowed > allowed.txt")
    assert.equal(await readFile(join(ctx.directory,'allowed.txt'),'utf8'),'allowed')
  })
})
