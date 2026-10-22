import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git,withFramework } from './framework-runtime.mjs'

// @mastra/code-sdk@1.14.0
// Documentation: installed dist/index.d.ts:28-130,293 (stock local runtime);
// dist/headless/types.d.ts:44-113 (runMC and external cancellation).
// Git installed `git push -h`: repository/refspec and set-upstream options.
// Fact: the builder's execution tool can push to a real local Git origin with
// dedicated runner HOME and no GitHub credential. This does not prove GitHub
// authentication; current stopped builder clone uses a local origin.
test('public workspace command pushes the exact candidate to a real local origin without inference', async () => {
  await withFramework(async directory => {
    git(directory, 'init', '-b', 'learning')
    git(directory, 'config', 'user.name', 'Framework Learning')
    git(directory, 'config', 'user.email', 'learning@example.invalid')
    await writeFile(join(directory, 'candidate'), 'real local push candidate\n')
    git(directory, 'add', 'candidate'); git(directory, 'commit', '-m', 'candidate')
    git(directory, 'init', '--bare', join(directory, 'remote.git'))
    git(directory, 'remote', 'add', 'origin', join(directory, 'remote.git'))
  }, async ctx => {
    assert.equal(git(ctx.directory, 'ls-remote', 'origin'), '')
    const command = 'git push -u origin learning'
    await ctx.execute(command)
    const expected = git(ctx.directory, 'rev-parse', 'HEAD')
    assert.equal(git(ctx.directory, 'ls-remote', 'origin', 'refs/heads/learning'), `${expected}\trefs/heads/learning`)
    console.log(JSON.stringify({fact:'direct-local-push',localHead:expected,remote:git(ctx.directory,'ls-remote','origin'),inferenceRequests:0}))
  })
})
