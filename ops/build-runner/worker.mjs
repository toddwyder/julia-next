import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { openRunner } from './adapter.mjs'
import { createPstackSession, inspectPstackRun } from './pstack-session.mjs'

const execFile = promisify(execFileCb)

function argValue(name) {
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return null
}

const jobDir = resolve(argValue('--job-dir') ?? process.env.BUILD_RUNNER_JOB_DIR ?? process.argv[2] ?? '')
if (!jobDir) { console.error('job dir required'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function readJob() { return JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8')) }
async function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}
async function atomicWriteText(file, value) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  await writeFile(tmp, value)
  await rename(tmp, file)
}
async function writeJsonl(file, values) {
  await atomicWriteText(file, values.map(v => JSON.stringify(v)).join('\n') + (values.length ? '\n' : ''))
}

async function main() {
  let job
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try { const candidate = await readJob(); if (candidate?.workerPid === process.pid) { job = candidate; break } } catch {}
    await sleep(50)
  }
  if (!job) job = await readJob()

  const snapshot = job.snapshot?.snapshot ?? job.snapshot ?? {}
  const card = snapshot.card ?? {}
  const cardId = card.identifier
  const savedRoles = snapshot.roles ?? {}
  const settingsPathValue = job.settingsPath ?? process.env.BUILD_RUNNER_SETTINGS ?? argValue('--settings') ?? resolve(process.cwd(), 'ops/build-runner/settings.json')
  const settings = JSON.parse(await readFile(settingsPathValue, 'utf8'))
  const pstackModels = await readFile(new URL('./pstack-models.md', import.meta.url), 'utf8')
  const session = createPstackSession(settings, { ...snapshot, machineryProof: job.machineryProof === true || snapshot.machineryProof }, pstackModels)
  const { orchestratorModel, coderModel, machineryProof, reviewModel, helpers, hostInstructions, prompt } = session
  const potetoSkill = await readFile(join(job.worktree, ".agents/skills/poteto-mode/SKILL.md"), "utf8")
  const workflowInstructions = `${hostInstructions}\n\nSelected workflow skill (authoritative):\n${potetoSkill}`
  const effectivePstackModels = session.pstackModels
  settings.roles = { orchestrator: orchestratorModel, coder: coderModel }
  const effectiveSettingsPath = join(jobDir, 'settings.json')
  await atomicWriteJson(effectiveSettingsPath, settings)
  const effectiveTable = { orchestrator: orchestratorModel, coder: coderModel, helpers: helpers.map(h => ({ id: h.id, modelId: h.defaultModelId })), pstackModels: effectivePstackModels, pstackModelsPath: join(jobDir, 'state', '.agents', 'pstack-models.md') }

  await mkdir(join(jobDir, 'state'), { recursive: true })
  const stateDir = join(jobDir, 'state')
  const { stdout: gitExcludePathOut } = await execFile('git', ['-C', job.worktree, 'rev-parse', '--git-path', 'info/exclude'])
  const excludePath = resolve(job.worktree, gitExcludePathOut.trim())
  await mkdir(dirname(excludePath), { recursive: true })
  let existingExclude = ''
  try { existingExclude = await readFile(excludePath, 'utf8') } catch {}
  if (!existingExclude.split(/\r?\n/).includes('.builder-home/')) {
    const prefix = existingExclude.length && !existingExclude.endsWith('\n') ? '\n' : ''
    await appendFile(excludePath, `${prefix}.builder-home/\n`)
  }

  const seedPstackModels = async dir => {
    const agentsDir = join(dir, '.agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'pstack-models.md'), effectivePstackModels)
  }
  await seedPstackModels(stateDir)
  const builderHome = join(job.worktree, '.builder-home')
  await mkdir(builderHome, { recursive: true })
  await seedPstackModels(builderHome)

  let runner
  const events = []
  const requests = []
  let receipt
  const receipts = []
  const workflowFeedback = []
  let failure = null
  let threadId
  let candidateCommit
  let account
  try {
    runner = await openRunner({ card: cardId, settingsPath: effectiveSettingsPath, cwd: job.worktree, stateDir, role: 'orchestrator', hostInstructions: workflowInstructions, subagents: helpers })
    const transportFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      let body
      try { body = await request.clone().json() } catch {}
      const entry = { model: body?.model, method: request.method, url: request.url }
      requests.push(entry)
      try {
        const response = await transportFetch(input, init)
        entry.status = response.status
        return response
      } catch (error) {
        entry.refusal = error.message
        throw error
      }
    }
    const allowedEventTypes = new Set(['subagent_start', 'subagent_end', 'subagent_tool_start', 'subagent_tool_end', 'tool_start', 'tool_end', 'agent_start', 'agent_end', 'error', 'task_updated', 'state_changed', 'message_end'])
    const unsubscribe = runner.runtime.session.subscribe(e => { if (allowedEventTypes.has(e?.type)) events.push(e) })
    let checklist
    let decisions
    let internalReview
    try {
      for (let turn = 0; turn < 3; turn += 1) {
        const instruction = turn === 0 ? prompt : workflowFeedback.at(-1)
        receipt = await runner.run({ prompt: instruction, ...(receipt?.threadId ? { threadId: receipt.threadId } : {}), maxTurns: 100, timeoutMs: 900000 })
        receipts.push(receipt)
        if (receipt?.result?.status !== 'completed') throw new Error('session not completed')
        try {
          checklist = await readFile(join(builderHome, 'pstack', 'checklist.md'), 'utf8')
          decisions = await readFile(join(builderHome, 'pstack', 'decisions.tsv'), 'utf8')
          internalReview = { ...inspectPstackRun({ events, requests, coderModel, reviewModel, machineryProof, checklist, decisions }), effectiveModels: effectiveTable }
          break
        } catch (error) {
          if (turn === 2) throw error
          workflowFeedback.push(`The selected workflow is incomplete. Observed missing evidence: ${error.message}. Continue poteto-mode in this same session. Read the selected playbook and follow every mandatory step rather than waiving it for task size. Use the configured model-role table and retain the required workflow artifacts. The saved card remains unchanged.`)
        }
      }
    } finally {
      unsubscribe()
    }
    threadId = receipt.threadId
    account = receipt.account ?? runner.snapshot()

    if (internalReview.deepseekSent && machineryProof) throw new Error('deepseek dispatched')
    await atomicWriteText(join(jobDir, 'pstack-checklist.md'), checklist)
    await atomicWriteText(join(jobDir, 'pstack-decisions.tsv'), decisions)
    await atomicWriteJson(join(jobDir, 'pstack-state.json'), runner.runtime.session.state.get())

    if (runner.runtime?.session?.model?.get?.() !== orchestratorModel) throw new Error('session model mismatch')
    if (account?.stopped !== false) throw new Error('account stopped')
    if (Number(account?.spentNano ?? 0) !== 0) throw new Error('nonzero spent')
    if (Number(account?.heldNano ?? 0) !== 0) throw new Error('nonzero held')

    const { stdout: statusBefore } = await execFile('git', ['-C', job.worktree, 'status', '--porcelain'])
    if (statusBefore.trim()) {
      await execFile('git', ['-C', job.worktree, 'add', '-A'])
      await execFile('git', ['-C', job.worktree, '-c', 'user.email=builder@example.com', '-c', 'user.name=Builder', 'commit', '-m', `build ${cardId}`])
    }
    const { stdout: headOut } = await execFile('git', ['-C', job.worktree, 'rev-parse', 'HEAD'])
    candidateCommit = headOut.trim()
    const { stdout: statusAfter } = await execFile('git', ['-C', job.worktree, 'status', '--porcelain'])
    if (statusAfter.trim()) throw new Error('candidate not clean')
    const { stdout: changedOut } = await execFile('git', ['-C', job.worktree, 'diff', '--name-only', `${job.baseCommit}..${candidateCommit}`])
    if (!changedOut.trim() || candidateCommit === job.baseCommit) throw new Error('empty candidate diff')
    await execFile('git', ['-C', job.worktree, 'merge-base', '--is-ancestor', job.baseCommit, candidateCommit])

    const successResult = {
      card,
      roles: savedRoles,
      actualModels: { orchestrator: orchestratorModel, coder: coderModel },
      threadId,
      worktree: job.worktree,
      baseCommit: job.baseCommit,
      candidateCommit,
      account,
      internalReview,
      downstreamReviewStarted: false,
      completedAt: new Date().toISOString(),
      state: 'ready-for-review',
    }
    job.state = 'ready-for-review'
    job.result = successResult
    job.error = null
  } catch (error) {
    failure = error
    job.state = 'failed'
    job.error = { message: error.message, stack: error.stack }
  } finally {
    try {
      await atomicWriteJson(join(jobDir, 'receipt.json'), receipt ?? {})
      await atomicWriteJson(join(jobDir, 'receipts.json'), receipts)
      await atomicWriteJson(join(jobDir, 'workflow-feedback.json'), workflowFeedback)
      await atomicWriteJson(join(jobDir, 'events.json'), events)
      await writeJsonl(join(jobDir, 'events.jsonl'), events)
      await atomicWriteJson(join(jobDir, 'requests.json'), requests)
      await writeJsonl(join(jobDir, 'requests.jsonl'), requests)
      await atomicWriteJson(join(jobDir, 'ledger.json'), account ?? runner?.snapshot?.() ?? {})
    } catch {}
    try { await runner?.close() } catch {}
    try { if (job) await atomicWriteJson(join(jobDir, 'job.json'), job) } catch {}
  }
  if (failure) process.exitCode = 1
}

main().catch(async error => {
  try {
    const job = await readJob()
    job.state = 'failed'
    job.error = { message: error.message, stack: error.stack }
    await atomicWriteJson(join(jobDir, 'job.json'), job)
  } catch {}
  console.error(error)
  process.exitCode = 1
})
