import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { startJob, readJob, listJobs } from '../jobs.mjs'

const execFile = promisify(execFileCb)

async function writeJob(jobsDir, runId, worktree, extra = {}) {
  const dir = join(jobsDir, runId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'job.json'), JSON.stringify({
    runId,
    snapshot: {},
    worktree,
    baseCommit: 'a'.repeat(40),
    state: 'running',
    runnerPid: process.pid,
    workerPid: null,
    result: null,
    error: null,
    createdAt: '2026-10-24T00:00:00.000Z',
    ...extra,
  }))
  return dir
}

test('a running job carries the checklist the build is writing', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'live-checklist-'))
  try {
    const jobsDir = join(tmp, 'jobs')
    const worktree = join(tmp, 'worktree')
    const runId = 'JUL-263-live'
    await mkdir(join(worktree, '.builder-home', 'pstack'), { recursive: true })
    await writeJob(jobsDir, runId, worktree)
    const checklist = join(worktree, '.builder-home', 'pstack', 'checklist.md')

    await writeFile(checklist, '# Build checklist\n\n- [x] Read the card\n- [ ] Write the test\n- [ ] Run the test\n')
    const first = await readJob(runId, { jobsDir })
    assert.deepStrictEqual(first.checklist.items, [
      { text: 'Read the card', done: true, depth: 0 },
      { text: 'Write the test', done: false, depth: 0 },
      { text: 'Run the test', done: false, depth: 0 },
    ])
    assert.equal(typeof first.checklist.updatedAt, 'string')

    await writeFile(checklist, '# Build checklist\n\n- [x] Read the card\n- [x] Write the test\n- [ ] Run the test\n  - [x] Nested proof\n')
    const middle = await readJob(runId, { jobsDir })
    assert.deepStrictEqual(middle.checklist.items, [
      { text: 'Read the card', done: true, depth: 0 },
      { text: 'Write the test', done: true, depth: 0 },
      { text: 'Run the test', done: false, depth: 0 },
      { text: 'Nested proof', done: true, depth: 1 },
    ])

    await writeFile(checklist, '- [x] One\n- [X] Two\n1. [x] Three\n')
    const final = await readJob(runId, { jobsDir })
    assert.deepStrictEqual(final.checklist.items.map(item => item.done), [true, true, true])

    const listed = await listJobs({ jobsDir })
    assert.deepStrictEqual(listed[0].checklist, final.checklist)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a finished job falls back to the checklist kept beside the job', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'live-checklist-final-'))
  try {
    const jobsDir = join(tmp, 'jobs')
    const worktree = join(tmp, 'worktree')
    const runId = 'JUL-263-finished'
    await mkdir(worktree, { recursive: true })
    const dir = await writeJob(jobsDir, runId, worktree, { state: 'ready-for-review' })
    await writeFile(join(dir, 'pstack-checklist.md'), '- [x] Kept step\n- [ ] Not finished\n')

    const job = await readJob(runId, { jobsDir })
    assert.deepStrictEqual(job.checklist.items, [
      { text: 'Kept step', done: true, depth: 0 },
      { text: 'Not finished', done: false, depth: 0 },
    ])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a job without a checklist still reports an empty checklist', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'live-checklist-empty-'))
  try {
    const jobsDir = join(tmp, 'jobs')
    const worktree = join(tmp, 'worktree')
    await mkdir(worktree, { recursive: true })
    await writeJob(jobsDir, 'JUL-263-empty', worktree)
    const job = await readJob('JUL-263-empty', { jobsDir })
    assert.deepStrictEqual(job.checklist, { items: [], updatedAt: null })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a Beam-only build is a practice run', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'live-checklist-beam-'))
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
    await writeFile(settingsPath, JSON.stringify({
      machineryModel: 'commandcode/reflection/beam:free',
      models: {
        'commandcode/reflection/beam:free': { wireModel: 'reflection/beam:free' },
        'commandcode/deepseek/deepseek-v4.1-flash': { wireModel: 'deepseek/deepseek-v4.1-flash' },
      },
    }))
    const fakeSpawn = () => {
      const child = new EventEmitter()
      child.pid = 4242
      child.unref = () => {}
      return child
    }
    const role = modelId => ({ route: 'commandcode', modelId, company: 'Test', service: 'CommandCode', effort: 'medium', wire: 'chat' })
    const init = (runId, coderModelId) => ({
      runId,
      state: 'ready-for-build',
      snapshot: {
        runId,
        card: { identifier: 'JUL-263', title: 'Practice', state: 'Ready', description: 'Saved requirements' },
        roles: { orchestrator: role('reflection/beam:free'), coder: role(coderModelId) },
        state: 'ready-for-build',
        initializedAt: '2026-10-24T00:00:00.000Z',
      },
    })
    const options = { jobsDir, repo, base, settingsPath, port: 0, spawn: fakeSpawn }

    const practice = await startJob(init('JUL-263-beam', 'reflection/beam:free'), options)
    assert.equal(practice.machineryProof, true)

    const real = await startJob(init('JUL-263-real', 'deepseek/deepseek-v4.1-flash'), options)
    assert.equal(real.machineryProof, undefined)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
