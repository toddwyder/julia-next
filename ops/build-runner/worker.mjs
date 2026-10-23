import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { openRunner } from './adapter.mjs'

const execFile = promisify(execFileCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

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

function resolveModelKey(settings, role) {
  const raw = typeof role === 'string' ? role : (role?.modelId ?? role?.model)
  if (!raw) return undefined
  const spec = settings.models?.[raw]
  if (spec) {
    if (role && typeof role !== 'string') {
      for (const field of ['provider', 'route', 'service', 'wire', 'company']) {
        const expected = role[field] ?? (field === 'provider' ? role.route : undefined)
        const actual = spec[field] ?? (field === 'provider' ? spec.route : undefined)
        if (expected != null && actual != null && expected !== actual) throw new Error(`model provider mismatch: ${raw}`)
      }
    }
    return raw
  }
  const matches = Object.keys(settings.models ?? {}).filter(key => settings.models[key]?.wireModel === raw)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`ambiguous model: ${raw}`)
  return raw
}

function deepSeekKey(settings) {
  for (const [key, spec] of Object.entries(settings.models ?? {})) {
    const hay = [key, spec?.modelId, spec?.wireModel, spec?.id, spec?.name].join(' ').toLowerCase()
    if (hay.includes('deepseek')) return key
  }
  return undefined
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
  const description = card.description ?? ''
  const savedRoles = snapshot.roles ?? {}
  const settingsPathValue = job.settingsPath ?? process.env.BUILD_RUNNER_SETTINGS ?? argValue('--settings') ?? resolve(process.cwd(), 'ops/build-runner/settings.json')
  const settings = JSON.parse(await readFile(settingsPathValue, 'utf8'))
  const orchestratorModel = resolveModelKey(settings, savedRoles.orchestrator)
  const coderModel = resolveModelKey(settings, savedRoles.coder)
  const machineryProof = job.machineryProof === true || snapshot.machineryProof === true || settings.machineryProof === true
  const deepseekModel = machineryProof ? deepSeekKey(settings) : undefined
  settings.roles = { orchestrator: orchestratorModel, coder: coderModel }
  const effectiveSettingsPath = join(jobDir, 'settings.json')
  await atomicWriteJson(effectiveSettingsPath, settings)

  const pstackModels = await readFile(new URL('./pstack-models.md', import.meta.url), 'utf8')
  const effectivePstackModels = machineryProof
    ? pstackModels.split(/\r?\n/).map(line => {
        const trimmed = line.trimStart()
        if (!trimmed || trimmed.startsWith('#')) return line
        const colon = line.indexOf(':')
        if (colon === -1) return line
        const value = line.slice(colon + 1)
        return line.slice(0, colon + 1) + value.replace(/[^,\s][^,]*/g, coderModel)
      }).join('\n')
    : pstackModels
  const configuredHelpers = Array.isArray(settings.helpers) ? settings.helpers : Array.isArray(settings.subagents) ? settings.subagents : []
  const normalizeHelper = h => {
    const rawModel = h.defaultModelId ?? h.modelId ?? h.model
    const resolvedModel = resolveModelKey(settings, rawModel)
    if (!resolvedModel || !settings.models?.[resolvedModel]) throw new Error(`unknown model: ${rawModel}`)
    return {
      id: h.id ?? h.agentType ?? h.name,
      name: h.name ?? h.id ?? h.agentType,
      description: h.description ?? '',
      instructions: h.instructions ?? h.prompt ?? '',
      defaultModelId: machineryProof ? coderModel : resolvedModel,
      ...(Array.isArray(h.allowedWorkspaceTools) ? { allowedWorkspaceTools: h.allowedWorkspaceTools } : {}),
      ...(Number.isFinite(h.maxSteps) ? { maxSteps: h.maxSteps } : {}),
    }
  }
  const coderHelper = { id: 'coder', name: 'Coder', description: 'Implements the build.', instructions: 'Implement the requested build changes in the worktree.', defaultModelId: coderModel, allowedWorkspaceTools: ['execute_command', 'mastra_workspace_read_file', 'mastra_workspace_write_file', 'mastra_workspace_edit_file', 'mastra_workspace_list_files'], maxSteps: 12 }
    const reviewerHelper = { id: 'reviewer', name: 'Internal Reviewer', description: 'Reviews and proves the build.', instructions: `Review and prove the build changes. Check actual changed files against the saved card acceptance criteria using workspace tools. Run actual file/command checks for content. The host owns the Git commit/clean-candidate check after model work, so do not retry Git administrative-path permission failures. Return the final literal REVIEW_AND_PROOF_PASSED only if all actual checks pass; otherwise return REVIEW_AND_PROOF_FAILED with reason.\n\nAuthoritative saved description:\n${description}`, defaultModelId: coderModel, maxSteps: 12 }
  const helpers = [coderHelper, reviewerHelper, ...configuredHelpers.map(normalizeHelper)]
  if (machineryProof) {
    if (!deepseekModel || !settings.models?.[deepseekModel]) throw new Error(`unknown model: ${deepseekModel ?? 'deepseek'}`)
    helpers.push({ id: 'cap-check', name: 'Cap Check', description: 'Cap check helper.', instructions: 'Run a trivial request to check the cap.', defaultModelId: deepseekModel, maxSteps: 1 })
  }
  if (!orchestratorModel || !settings.models?.[orchestratorModel]) throw new Error(`unknown model: ${orchestratorModel}`)
  if (!coderModel || !settings.models?.[coderModel]) throw new Error(`unknown model: ${coderModel}`)
  const effectiveTable = { orchestrator: orchestratorModel, coder: coderModel, helpers: helpers.map(h => ({ id: h.id, modelId: h.defaultModelId })), pstackModels: effectivePstackModels, pstackModelsPath: join(jobDir, 'state', '.agents', 'pstack-models.md') }
  const overrideSection = machineryProof ? `\n\nMachinery proof helper overrides:\n${helpers.map(h => `- ${h.id}: ${h.defaultModelId}`).join('\n')}` : ''
  const hostInstructions = `${effectivePstackModels}\n\nRequirements:\n${description}${overrideSection}`

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
  let failure = null
  let threadId
  let candidateCommit
  let account
  try {
    runner = await openRunner({ card: cardId, settingsPath: effectiveSettingsPath, cwd: job.worktree, stateDir, role: 'orchestrator', hostInstructions, subagents: helpers })
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
    const allowedEventTypes = new Set(['subagent_start', 'subagent_end', 'subagent_tool_start', 'subagent_tool_end', 'tool_start', 'tool_end', 'agent_start', 'agent_end', 'error'])
    const unsubscribe = runner.runtime.session.subscribe(e => { if (allowedEventTypes.has(e?.type)) events.push(e) })
    const prompt = machineryProof
      ? `You are the orchestrator for ${cardId}.\n\nRequirements:\n${description}\n\nFirst read .agents/skills/poteto-mode/SKILL.md and follow it for this task, before delegating coder/reviewer/proof.\n\nDelegate implementation to the coder helper, then internal review and proof to the reviewer helper, then run the cap-check helper once. Do not override helper models or retry the expected DeepSeek refusal. Report completion after all three.`
      : `You are the orchestrator for ${cardId}.\n\nRequirements:\n${description}\n\nFirst read .agents/skills/poteto-mode/SKILL.md and follow it for this task, before delegating coder/reviewer/proof.\n\nDelegate implementation to the coder helper, then internal review and proof to the reviewer helper. Report completion after both.`
    try {
      receipt = await runner.run({ prompt, maxTurns: 30, timeoutMs: 300000 })
    } finally {
      unsubscribe()
    }
    threadId = receipt.threadId
    account = receipt.account ?? runner.snapshot()

    const starts = events.filter(e => e.type === 'subagent_start')
    const ends = events.filter(e => e.type === 'subagent_end')
    const coderStart = starts.find(e => e.agentType === 'coder')
    const reviewerStart = starts.find(e => e.agentType === 'reviewer')
    const coderEnd = ends.find(e => e.agentType === 'coder')
    const reviewerEnd = ends.find(e => e.agentType === 'reviewer')
    const deepseekStart = starts.find(e => e.agentType === 'cap-check')
    const deepseekEnd = ends.find(e => e.agentType === 'cap-check')
    const deepseekRefusal = requests.some(r => /deepseek/i.test(String(r.model)) && String(r.refusal ?? '').includes('Trial forbids nonzero model prices'))
    const deepseekSent = requests.some(r => /deepseek/i.test(String(r.model)) && r.status != null)

    if (receipt?.result?.status !== 'completed') throw new Error('session not completed')
    if (!coderStart || coderStart.modelId !== coderHelper.defaultModelId) throw new Error('missing coder start')
    if (!reviewerStart || reviewerStart.modelId !== reviewerHelper.defaultModelId) throw new Error('missing reviewer start')
    if (!coderEnd || coderEnd.isError || !coderEnd.result) throw new Error('coder failed')
    if (!reviewerEnd || reviewerEnd.isError || !reviewerEnd.result) throw new Error('reviewer failed')
    if (!String(reviewerEnd.result ?? '').includes('REVIEW_AND_PROOF_PASSED')) throw new Error('reviewer failed')
    if (String(reviewerEnd.result ?? '').includes('REVIEW_AND_PROOF_FAILED')) throw new Error('reviewer failed')
    if (!events.some(e => e?.type === 'subagent_tool_end' && e?.agentType === 'reviewer' && e?.isError === false)) throw new Error('reviewer failed')
    if (machineryProof) {
      if (!deepseekStart || deepseekStart.modelId !== deepseekModel) throw new Error('missing deepseek start')
      if (!deepseekEnd || !deepseekEnd.isError || !String(deepseekEnd.result ?? '').includes('Trial forbids nonzero model prices')) throw new Error('missing deepseek refusal')
      if (!deepseekRefusal) throw new Error('missing deepseek refusal')
      if (deepseekSent) throw new Error('deepseek dispatched')
    }
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

    const internalReview = { events, starts, ends, hasCoder: !!coderStart, hasReviewer: !!reviewerEnd, reviewerErrors: ends.some(e => e.agentType === 'reviewer' && e.isError), deepseekRefusal, deepseekSent, effectiveModels: effectiveTable }
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
