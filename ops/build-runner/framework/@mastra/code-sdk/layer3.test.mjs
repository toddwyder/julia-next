import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile, mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { git,withFramework } from './framework-runtime.mjs'

// @mastra/code-sdk@1.14.0
// Documentation: installed dist/index.d.ts:43-44 (postToolObserver),
// dist/agents/tools.d.ts:28 (void async observer); dist/headless/types.d.ts:44-113.
// https://mastra.ai/reference/code-sdk/mount-agent-controller#parameters
// Fact: an awaited postToolObserver sees and checks EVERY new commit, including
// multiple commits in one actual public tool call, before execute resolves.
// Readiness persistence is a learning-only Julia policy sketch, not a deployed runner.
test(`public tool awaits every exact-commit observation before returning`, { timeout: 240000 }, async () => {
  let directory, baseline, lastSeen, executeResolved = false
  const observations = []
  const observe = async () => {
    const commits = git(directory, 'rev-list', '--reverse', `${lastSeen}..HEAD`).split('\n').filter(Boolean)
    for (const commit of commits) {
      const snapshot = await mkdtemp(join(tmpdir(), 'commit-learning-'))
      try {
        const archive = execFileSync('git', ['archive', commit], { cwd: directory })
        const tar = spawnSync('tar', ['-x', '-C', snapshot], { input: archive })
        assert.equal(tar.status, 0)
        const checkEnv = { ...process.env }; delete checkEnv.NODE_TEST_CONTEXT
        const check = spawnSync(process.execPath, ['--test', 'answer.test.mjs'], { cwd: snapshot, encoding: 'utf8', env: checkEnv })
        assert.match(check.stdout, /tests 1/)
        observations.push({ commit, tree: git(directory, 'rev-parse', `${commit}^{tree}`), status: check.status, stdout: check.stdout, stderr: check.stderr, beforeExecuteResolved: !executeResolved })
      } finally { await rm(snapshot, { recursive: true, force: true }) }
    }
    lastSeen = git(directory, 'rev-parse', 'HEAD')
  }
  await withFramework(async dir => {
    directory = dir
    git(dir, 'init', '-b', 'learning'); git(dir, 'config', 'user.name', 'Framework Learning'); git(dir, 'config', 'user.email', 'learning@example.invalid')
    await writeFile(join(dir, 'answer.mjs'), 'export const answer=42;\n')
    await writeFile(join(dir, 'answer.test.mjs'), "import assert from 'node:assert/strict'; import { answer } from './answer.mjs'; assert.equal(answer,42);\n")
    git(dir, 'add', 'answer.mjs', 'answer.test.mjs'); git(dir, 'commit', '-m', 'baseline')
    baseline = lastSeen = git(dir, 'rev-parse', 'HEAD')
  }, async ctx => {
    const command = "printf 'export const answer=41;\\n' > answer.mjs && git add answer.mjs && git commit -m broken && printf 'export const answer=42;\\n' > answer.mjs && git add answer.mjs && git commit -m repaired"
    await ctx.execute(command)
    executeResolved = true
    const actual = git(directory, 'rev-list', '--reverse', `${baseline}..HEAD`).split('\n')
    assert.equal(actual.length, 2)
    assert.deepEqual(observations.map(o => o.commit), actual)
    assert.deepEqual(observations.map(o => o.status), [1, 0])
    assert.ok(observations.every(o => o.beforeExecuteResolved), 'observer must finish before public execute resolves')
    async function saveReady(checks, target) {
      if (!checks.length || checks.some(c => c.status !== 0)) throw new Error('build is not ready for review: exact-commit check failed')
      await writeFile(target, JSON.stringify({ commit: git(directory, 'rev-parse', 'HEAD') }))
    }
    const marker = join(directory, 'ready-for-review.json')
    await assert.rejects(saveReady([observations[0]], marker), /exact-commit check failed/)
    await assert.rejects(access(marker))
    console.log(JSON.stringify({ layer: 3, observations, readiness: 'refused for failing exact commit' }))
    await saveReady([observations[1]], marker)
    console.log(JSON.stringify({ layer: 3, checkedCommit: observations[1].commit, readiness: 'saved for passing exact commit' }))
  }, { observer: observe })
})
