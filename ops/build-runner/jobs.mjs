import { spawn as defaultSpawn } from 'node:child_process'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { hydrateSettings, loadCatalogue } from './catalogue.mjs'

const execFile = promisify(execFileCb)
const __dirname = dirname(fileURLToPath(import.meta.url))
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CHECKLIST_LIMIT = 256 * 1024
const pendingStarts = new Map()

const SKIPPED_STEP = /\b(?:skip(?:ped)?|n\/a|not applicable|out of scope)\b/i

function checklistStatus(text, checked) {
  if (checked) return 'finished'
  if (/\bdone:/i.test(text)) return 'finished'
  if (SKIPPED_STEP.test(text)) return 'skipped'
  return 'pending'
}

export function summarizeChecklist(items) {
  const summary = { finished: 0, skipped: 0, pending: 0 }
  for (const item of items) summary[item.status] += 1
  return summary
}

export function parseChecklist(text) {
  const items = []
  for (const line of String(text).split(/\r?\n/)) {
    const indent = /^([ \t]*)/.exec(line)?.[1] ?? ''
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2)
    const checkbox = /^[ \t]*(?:[-*]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/.exec(line)
    if (checkbox) {
      const item = checkbox[2].trim()
      if (item) items.push({ text: item, status: checklistStatus(item, checkbox[1].toLowerCase() === 'x'), depth })
      continue
    }
    const numbered = /^[ \t]*\d+[.)]\s+(.+)$/.exec(line)
    if (!numbered) continue
    const item = numbered[1].trim()
    if (!item) continue
    items.push({ text: item, status: checklistStatus(item, false), depth })
  }
  return items
}

async function readChecklistFile(file) {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > CHECKLIST_LIMIT) return null
    const items = parseChecklist(await readFile(file, 'utf8'))
    return { items, summary: summarizeChecklist(items), updatedAt: info.mtime.toISOString() }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function withChecklist(job, jobsDir) {
  if (!job || typeof job !== 'object') return job
  const candidates = []
  if (typeof job.worktree === 'string' && job.worktree) candidates.push(join(job.worktree, '.builder-home', 'pstack', 'checklist.md'))
  if (typeof job.runId === 'string' && RUN_ID_RE.test(job.runId)) candidates.push(join(jobsDir, job.runId, 'pstack-checklist.md'))
  for (const file of candidates) {
    const checklist = await readChecklistFile(file)
    if (checklist) return { ...job, checklist }
  }
  return { ...job, checklist: { items: [], summary: { finished: 0, skipped: 0, pending: 0 }, updatedAt: null } }
}

async function isMachineryPractice(snapshot, settingsPath) {
  if (!settingsPath) return false
  let settings
  try { settings = JSON.parse(await readFile(settingsPath, 'utf8')) } catch { return false }
  const key = settings?.machineryModel
  if (!key) return false
  if (!settings.models) {
    try { settings = hydrateSettings(settings, await loadCatalogue({ settingsPath })) } catch { return false }
  }
  const wire = settings.models?.[key]?.wireModel
  if (!wire) return false
  return snapshot.roles?.orchestrator?.modelId === wire && snapshot.roles?.coder?.modelId === wire
}

function resolveOpts(options = {}) {
  const jobsDir = options.jobsDir ?? process.env.BUILD_RUNNER_JOBS_DIR ?? null
  const resolvedJobsDir = jobsDir ? resolve(jobsDir) : resolve(process.cwd(), '.build-jobs')
  const repo = resolve(options.repo ?? process.env.BUILD_RUNNER_REPO ?? process.cwd())
  const base = options.base ?? process.env.BUILD_RUNNER_BASE ?? null
  const settingsPath = options.settingsPath ?? process.env.BUILD_RUNNER_SETTINGS ?? null
  const port = Number(options.port ?? process.env.BUILD_RUNNER_PORT ?? 8787)
  const spawnImpl = options.spawn ?? defaultSpawn
  return { jobsDir: resolvedJobsDir, repo, base, settingsPath, spawnImpl, port }
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('init result required')
  const runId = input.runId
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Error('runId required')
  const snapshot = input.snapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot required')
  if (snapshot.runId !== runId) throw new Error('runId mismatch')
  const card = snapshot.card
  if (!card || typeof card !== 'object' || Array.isArray(card) || typeof card.identifier !== 'string' || !card.identifier.trim()) throw new Error('card identifier required')
  const roles = snapshot.roles
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) throw new Error('roles required')
  const keys = Object.keys(roles)
  if (!keys.includes('orchestrator') || !keys.includes('coder') || keys.some(key => !['orchestrator', 'coder', 'reviewer'].includes(key))) throw new Error('exact roles required')
  for (const key of ['orchestrator', 'coder', ...(roles.reviewer === undefined ? [] : ['reviewer'])]) {
    const role = roles[key]
    if (!role || typeof role !== 'object' || Array.isArray(role) || typeof role.modelId !== 'string' || !role.modelId.trim()) throw new Error(`${key} modelId required`)
  }
  return { runId, snapshot }
}

function jobPath(jobsDir, runId) { return join(jobsDir, runId, 'job.json') }

async function readJobFile(jobsDir, runId) {
  const raw = await readFile(jobPath(jobsDir, runId), 'utf8')
  return JSON.parse(raw)
}

async function writeJobFile(jobsDir, runId, job) {
  const dir = join(jobsDir, runId)
  await mkdir(dir, { recursive: true })
  const file = jobPath(jobsDir, runId)
  const tmp = join(dir, `.job.json.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(tmp, JSON.stringify(job, null, 2))
  await rename(tmp, file)
}

async function resolveBase(repo, base) {
  if (base != null && String(base).trim()) return String(base).trim()
  const { stdout } = await execFile('git', ['-C', repo, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function startJob(input, options = {}) {
  const opts = resolveOpts(options)
  const { runId, snapshot } = normalize(input)
  const key = join(opts.jobsDir, runId)
  const pending = pendingStarts.get(key)
  if (pending) {
    if (JSON.stringify(pending.savedSnapshot) !== JSON.stringify(snapshot)) {
      return Promise.reject(new Error(`conflicting input for ${runId}`))
    }
    return pending
  }

  const operation = (async () => {
    try {
      const archiveStaleFailedRun = async () => {
        const archive = join(opts.jobsDir, `${runId}.failed-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await rename(join(opts.jobsDir, runId), archive)
        return archive
      }

      try {
        await stat(jobPath(opts.jobsDir, runId))
        const existing = await readJobFile(opts.jobsDir, runId)
        if (JSON.stringify(existing?.snapshot) !== JSON.stringify(snapshot)) throw new Error(`conflicting input for ${runId}`)
        if (existing.state !== 'failed') return await withChecklist(existing, opts.jobsDir)
        await archiveStaleFailedRun()
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }

      const baseCommit = await resolveBase(opts.repo, opts.base)
      const jobDir = join(opts.jobsDir, runId)
      await mkdir(jobDir, { recursive: true })
      const worktree = join(jobDir, 'worktree')
      await execFile('git', ['clone', '--no-local', '--no-checkout', opts.repo, worktree])
      await execFile('git', ['-C', worktree, 'sparse-checkout', 'set', '--no-cone', '/*', '!/docs/agents/', '!/.audit/', '!/agent-transcripts/'])
      await execFile('git', ['-C', worktree, 'checkout', '--detach', baseCommit])
      await execFile('git', ['-C', worktree, 'config', 'user.name', 'Julia Build'])
      await execFile('git', ['-C', worktree, 'config', 'user.email', 'julia-build@localhost'])
      await writeFile(join(jobDir, 'snapshot.json'), JSON.stringify(input, null, 2))

      const job = {
        runId,
        snapshot,
        settingsPath: opts.settingsPath,
        worktree,
        baseCommit,
        runnerPid: process.pid,
        state: 'running',
        workerPid: null,
        result: null,
        error: null,
        createdAt: new Date().toISOString(),
        ...(await isMachineryPractice(snapshot, opts.settingsPath) ? { machineryProof: true } : {}),
      }
      await writeJobFile(opts.jobsDir, runId, job)

      const workerPath = join(__dirname, 'worker.mjs')
      const logFd = openSync(join(jobDir, 'worker.log'), 'a')
      let child
      try {
        child = opts.spawnImpl(process.execPath, [workerPath, '--job-dir', jobDir], {
          stdio: ['ignore', logFd, logFd],
          env: opts.env ?? process.env,
        })
      } finally {
        closeSync(logFd)
      }
      job.workerPid = child?.pid ?? null
      await writeJobFile(opts.jobsDir, runId, job)
      return await withChecklist(await readJobFile(opts.jobsDir, runId), opts.jobsDir)
    } finally {
      pendingStarts.delete(key)
    }
  })()

  operation.savedSnapshot = snapshot
  pendingStarts.set(key, operation)
  return operation
}

export async function readJob(runId, options = {}) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Error('runId required')
  const opts = resolveOpts(options)
  return await withChecklist(await readJobFile(opts.jobsDir, runId), opts.jobsDir)
}

export async function continueJob(runId, options = {}) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Error('runId required')
  const opts = resolveOpts(options)
  const job = await readJobFile(opts.jobsDir, runId)
  if (job.state !== 'paused') throw new Error(`build ${runId} is not paused`)
  const jobDir = join(opts.jobsDir, runId)
  job.state = 'running'
  job.error = null
  job.workerPid = null
  await writeJobFile(opts.jobsDir, runId, job)
  const workerPath = join(__dirname, 'worker.mjs')
  const logFd = openSync(join(jobDir, 'worker.log'), 'a')
  let child
  try {
    child = opts.spawnImpl(process.execPath, [workerPath, '--job-dir', jobDir, '--continue'], {
      stdio: ['ignore', logFd, logFd],
      env: opts.env ?? process.env,
    })
  } finally {
    closeSync(logFd)
  }
  job.workerPid = child?.pid ?? null
  await writeJobFile(opts.jobsDir, runId, job)
  return await withChecklist(await readJobFile(opts.jobsDir, runId), opts.jobsDir)
}

export async function listJobs(options = {}) {
  const opts = resolveOpts(options)
  const entries = await readdir(opts.jobsDir, { withFileTypes: true }).catch(() => [])
  const jobs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      jobs.push(await withChecklist(await readJobFile(opts.jobsDir, entry.name), opts.jobsDir))
    } catch {}
  }
  return jobs
}

function createRunnerServer(options = {}) {
  const opts = resolveOpts(options)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/jobs') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(await listJobs(opts)))
        return
      }
      if (req.method === 'POST' && url.pathname === '/jobs') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const job = await startJob(body, opts)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(job))
        return
      }
      const match = url.pathname.match(/^\/jobs\/([^/]+)$/)
      if (req.method === 'GET' && match) {
        const job = await readJob(decodeURIComponent(match[1]), opts)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(job))
        return
      }
      const continueMatch = url.pathname.match(/^\/jobs\/([^/]+)\/continue$/)
      if (req.method === 'POST' && continueMatch) {
        const job = await continueJob(decodeURIComponent(continueMatch[1]), opts)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(job))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
  server.jobsOptions = opts
  return server
}

export async function startRunnerServer(options = {}) {
  const server = createRunnerServer(options)
  const opts = server.jobsOptions
  await new Promise((resolvePromise, rejectPromise) => {
    const onListening = () => {
      server.off('error', onError)
      resolvePromise()
    }
    const onError = (error) => {
      server.off('listening', onListening)
      rejectPromise(error)
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(opts.port, '127.0.0.1')
  })
  return server
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  ;(async () => {
    try {
      await startRunnerServer({
        jobsDir: process.env.BUILD_RUNNER_JOBS_DIR,
        repo: process.env.BUILD_RUNNER_REPO,
        settingsPath: process.env.BUILD_RUNNER_SETTINGS,
        port: process.env.BUILD_RUNNER_PORT ? Number(process.env.BUILD_RUNNER_PORT) : undefined,
      })
      await new Promise(() => {})
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })()
}
