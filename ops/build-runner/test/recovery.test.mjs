import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { continueJob, readJob, startJob } from '../jobs.mjs'

const execFile = promisify(execFileCb)

async function repository(root) {
  const repo = join(root, 'repo')
  await mkdir(repo)
  await execFile('git', ['init', repo])
  await execFile('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  await execFile('git', ['-C', repo, 'config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), 'hello\n')
  await execFile('git', ['-C', repo, 'add', '.'])
  await execFile('git', ['-C', repo, 'commit', '-m', 'init'])
  return { repo, base: (await execFile('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim() }
}

function fakeSpawn(calls) {
  return (_command, args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.pid = 5000 + calls.length
    child.unref = () => {}
    return child
  }
}

const runId = 'JUL-400-run'
const snapshot = {
  runId,
  card: { identifier: 'JUL-400', title: 'Recovery', state: 'Ready', description: 'Saved requirements' },
  roles: {
    orchestrator: { route: 'commandcode', modelId: 'reflection/beam:free', company: 'Reflection', service: 'CommandCode', effort: 'medium', wire: 'chat' },
    coder: { route: 'commandcode', modelId: 'reflection/beam:free', company: 'Reflection', service: 'CommandCode', effort: 'medium', wire: 'chat' },
  },
  state: 'ready-for-build',
  initializedAt: '2026-10-25T00:00:00.000Z',
}

test('Start on a card whose last run failed starts a fresh run and keeps the old records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobs-failed-restart-'))
  try {
    const { repo, base } = await repository(root)
    const jobsDir = join(root, 'jobs')
    const staleDir = join(jobsDir, runId)
    await mkdir(staleDir, { recursive: true })
    await writeFile(join(staleDir, 'job.json'), JSON.stringify({
      runId, snapshot, worktree: join(root, 'old-worktree'), baseCommit: base,
      state: 'failed', runnerPid: process.pid, workerPid: null, result: null,
      error: { message: 'old failure' }, createdAt: '2026-10-25T00:00:00.000Z',
    }))
    await writeFile(join(staleDir, 'worker.log'), 'old log\n')
    const calls = []
    const options = { jobsDir, repo, base, settingsPath: join(root, 'settings.json'), port: 0, spawn: fakeSpawn(calls) }
    const fresh = await startJob({ runId, state: 'ready-for-build', snapshot }, options)
    assert.equal(fresh.state, 'running')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].includes('--continue'), false)
    const entries = await readdir(jobsDir)
    const archived = entries.filter(entry => entry.startsWith(`${runId}.failed-`))
    assert.equal(archived.length, 1)
    assert.equal((await readJob(archived[0], options)).error.message, 'old failure')
    assert.notEqual(fresh.worktree, join(root, 'old-worktree'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a paused build continues in the same worktree with its saved thread', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobs-continue-'))
  try {
    const jobsDir = join(root, 'jobs')
    const dir = join(jobsDir, runId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'job.json'), JSON.stringify({
      runId, snapshot, worktree: join(root, 'worktree'), baseCommit: 'a'.repeat(40),
      state: 'paused', runnerPid: process.pid, workerPid: null, result: null,
      error: { message: 'runaway: reached the 100-turn limit' },
      pause: { reason: 'runaway', threadId: 'thread-7', at: '2026-10-25T01:00:00.000Z' },
    }))
    const calls = []
    const job = await continueJob(runId, { jobsDir, spawn: fakeSpawn(calls) })
    assert.equal(job.state, 'running')
    assert.equal(job.workerPid, 5001)
    assert.equal(calls.length, 1)
    assert.ok(calls[0].includes('--continue'))
    assert.equal(calls[0].includes('--job-dir'), true)
    assert.equal(job.worktree, join(root, 'worktree'))
    await assert.rejects(continueJob(runId, { jobsDir, spawn: fakeSpawn(calls) }), /not paused/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
