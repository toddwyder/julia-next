import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { startJob, readJob, listJobs, startRunnerServer } from '../jobs.mjs'

const execFile = promisify(execFileCb)

test('jobs', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'jobs-test-'))
  let server
  try {
    const repo = join(tmp, 'repo')
    await mkdir(repo)
    await execFile('git', ['init', repo])
    await execFile('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
    await execFile('git', ['-C', repo, 'config', 'user.name', 'Test'])
    await writeFile(join(repo, 'README.md'), 'hello\n')
    await execFile('git', ['-C', repo, 'add', '.'])
    await execFile('git', ['-C', repo, 'commit', '-m', 'init'])
    const base = (await execFile('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim()
    const jobsDir = join(tmp, 'jobs')
    await mkdir(jobsDir)
    const settingsPath = join(tmp, 'settings.json')
    await writeFile(settingsPath, '{}')
    let spawns = 0
    const fakeSpawn = () => {
      spawns += 1
      const child = new EventEmitter()
      child.pid = 4242
      child.unref = () => {}
      return child
    }
    const runId = 'JUL-232-run'
    const snapshot = {
      runId,
      card: { identifier: 'JUL-232', title: 'Practice', state: 'Ready', description: 'Saved exact requirements' },
      roles: {
        orchestrator: { route: 'commandcode', modelId: 'reflection/beam:free', company: 'Reflection', service: 'CommandCode', effort: 'medium', wire: 'chat' },
        coder: { route: 'commandcode', modelId: 'reflection/beam:free', company: 'Reflection', service: 'CommandCode', effort: 'medium', wire: 'chat' }
      },
      state: 'ready-for-build',
      initializedAt: '2026-10-23T14:00:00.000Z'
    }
    const initResult = { runId, state: 'ready-for-build', snapshot }
    const options = { jobsDir, repo, base, settingsPath, port: 0, spawn: fakeSpawn }
    const [job, duplicate] = await Promise.all([startJob(initResult, options), startJob(initResult, options)])
    assert.equal(spawns, 1)
    assert.equal(job.runId, runId)
    assert.deepStrictEqual(job.snapshot, snapshot)
    assert.equal(typeof job.worktree, 'string')
    assert.equal(job.baseCommit, base)
    if (Object.prototype.hasOwnProperty.call(job, 'runnerPid')) assert.equal(job.runnerPid, process.pid)
    assert.equal(job.workerPid, 4242)
    assert.equal(job.state, 'running')
    assert.deepStrictEqual(duplicate, job)
    const head = (await execFile('git', ['-C', job.worktree, 'rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(head, base)
    const changed = JSON.parse(JSON.stringify(initResult))
    changed.snapshot.card.title = 'Changed'
    let rejected = false
    try {
      await startJob(changed, options)
    } catch (error) {
      rejected = true
      assert.match(error.message, /conflict/i)
    }
    assert.ok(rejected)
    assert.equal(spawns, 1)
    assert.equal((await readJob(runId, options)).snapshot.card.title, 'Practice')
    await assert.rejects(startJob({ ...initResult, runId: '../bad' }, options))
    await assert.rejects(startJob({ ...initResult, snapshot: { ...snapshot, runId: 'other' } }, options))
    const noCoder = JSON.parse(JSON.stringify(initResult))
    delete noCoder.snapshot.roles.coder
    await assert.rejects(startJob(noCoder, options))
    assert.equal(spawns, 1)
    const fresh = await readJob(runId, options)
    assert.deepStrictEqual(fresh, job)
    const builderHome = join(job.worktree, '.builder-home')
    await mkdir(builderHome, { recursive: true })
    const boundaryLauncher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const { stdout } = await execFile('python3', [boundaryLauncher, JSON.stringify({workspace:job.worktree,home:builderHome,cwd:job.worktree,executable:process.execPath}), 'git status --porcelain && git rev-parse HEAD'])
    assert.equal(stdout.trim(), base)
    const jobs = await listJobs(options)
    assert.equal(jobs.length, 1)
    assert.deepStrictEqual(jobs[0], fresh)
    server = await startRunnerServer(options)
    const address = server.address()
    assert.ok(address)
    const url = `http://127.0.0.1:${address.port}`
    const healthRes = await fetch(`${url}/health`)
    assert.equal(healthRes.status, 200)
    assert.equal(await healthRes.text(), JSON.stringify({ ok: true }))
    const listRes = await fetch(`${url}/jobs`)
    assert.equal(listRes.status, 200)
    assert.equal((await listRes.json()).length, 1)
    const postRes = await fetch(`${url}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initResult)
    })
    assert.equal(postRes.status, 200)
    assert.deepStrictEqual((await postRes.json()).snapshot, snapshot)
    const getRes = await fetch(`${url}/jobs/${encodeURIComponent(runId)}`)
    assert.equal(getRes.status, 200)
    assert.deepStrictEqual(await getRes.json(), fresh)
    const unknownRes = await fetch(`${url}/nope`)
    assert.equal(unknownRes.status, 404)
    assert.deepStrictEqual(await unknownRes.json(), { error: 'not found' })
  } finally {
    if (server) {
      server.close()
      await new Promise((resolve) => server.on('close', resolve))
    }
    await rm(tmp, { recursive: true, force: true })
  }
})
