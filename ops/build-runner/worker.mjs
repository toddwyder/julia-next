import { observeRequests } from './request-observer.mjs'
import { readFile, writeFile, rename, mkdir, appendFile, rm } from 'node:fs/promises'
import { realpathSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { openRunner, SESSION_INACTIVITY_MS } from './adapter.mjs'
import { hydrateSettings, loadCatalogue } from './catalogue.mjs'
import { createPstackSession, inspectPstackRun } from './pstack-session.mjs'
import { postLinearComment, moveLinearCard } from './linear-note.mjs'
import { pauseReason } from './worker-policy.mjs'
import {
  REQUIRED_PLAYBOOK,
  parseCriteria,
  declaredPlaybook,
  checkPlaybookConformity,
  nextStage,
  parseVerdicts,
  formatVerdictNote,
  requiredBuildPlaybook,
  requiredPlaybookForRun,
  unprovenVerdicts,
  reviewPrompt,
  remediationPrompt,
  investigationPrompt,
} from './evidence-review.mjs'

const execFile = promisify(execFileCb)
const PLAYBOOKS = '.agents/skills/poteto-mode/playbooks'
const REVIEW_SKILL = '.agents/skills/adversarial-review/SKILL.md'
const refusal = reason => Object.assign(new Error(`run refused: ${reason}`), { refused: `run refused: ${reason}` })
const stop = message => Object.assign(new Error(message), { stopped: message })

function argValue(name) {
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return null
}

const jobDir = resolve(argValue('--job-dir') ?? process.env.BUILD_RUNNER_JOB_DIR ?? process.argv[2] ?? '')
if (!jobDir) { console.error('job dir required'); process.exit(2) }
const continueRun = process.argv.includes('--continue')
const linearKey = process.env.LINEAR_API_KEY

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
async function readOptional(file) {
  try { return await readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
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
  const settingsPathValue = job.settingsPath ?? process.env.BUILD_RUNNER_SETTINGS ?? argValue('--settings') ?? fileURLToPath(new URL('./machine-settings.json', import.meta.url))
  const catalogue = await loadCatalogue({ settingsPath: settingsPathValue })
  const settings = hydrateSettings(JSON.parse(await readFile(settingsPathValue, 'utf8')), catalogue)
  settings.ledgerPath ??= join(dirname(jobDir), 'cards.sqlite')
  const signInFor = { claude: 'anthropic', 'openai-codex': 'openai-codex', commandcode: 'commandcode' }
  for (const spec of Object.values(settings.models)) {
    if (catalogue.connected?.[signInFor[spec.route]] === false) spec.unavailable ??= 'provider not signed in'
  }
  const pstackModels = await readFile(new URL('./pstack-models.md', import.meta.url), 'utf8')
  const session = createPstackSession(settings, { ...snapshot, machineryProof: job.machineryProof === true || snapshot.machineryProof }, pstackModels)
  const { orchestratorModel, coderModel, reviewerModel, helpers, hostInstructions, prompt } = session
  const potetoSkill = await readFile(join(job.worktree, '.agents/skills/poteto-mode/SKILL.md'), 'utf8')
  const workflowInstructions = `${hostInstructions}\n\nSelected workflow skill (authoritative):\n${potetoSkill}`
  const effectivePstackModels = session.pstackModels
  settings.roles = { orchestrator: orchestratorModel, coder: coderModel, ...(reviewerModel ? { reviewer: reviewerModel } : {}) }
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
  let failure = null
  let threadId
  let candidateCommit
  let account
  let checklist
  let decisions
  let internalReview
  const allowedEventTypes = new Set(['subagent_start', 'subagent_end', 'subagent_tool_start', 'subagent_tool_end', 'tool_start', 'tool_end', 'agent_start', 'agent_end', 'error', 'task_updated', 'state_changed', 'message_end'])
  const criteria = parseCriteria(card)

  async function runStage({ role, cwd, settingsPath, stateDir: stageStateDir, hostInstructions: stageInstructions, prompt: stagePrompt, subagents = helpers }) {
    const stageRunner = await openRunner({ card: cardId, settingsPath, cwd, stateDir: stageStateDir, role, hostInstructions: stageInstructions, subagents })
    globalThis.fetch = observeRequests(globalThis.fetch, requests)
    const unsubscribe = stageRunner.runtime.session.subscribe(e => { if (allowedEventTypes.has(e?.type)) events.push(e) })
    try {
      const stageReceipt = await stageRunner.run({ prompt: stagePrompt, maxTurns: 100, inactivityMs: SESSION_INACTIVITY_MS })
      receipts.push(stageReceipt)
      receipt = stageReceipt
      const paused = pauseReason(stageReceipt?.result?.status, stageReceipt?.result?.error?.message)
      if (paused) { const error = new Error(paused); error.pause = paused; throw error }
      if (stageReceipt?.result?.status !== 'completed') throw new Error(stageReceipt?.result?.error?.message ?? `session ended ${stageReceipt?.result?.status ?? 'without a result'}`)
      account = stageReceipt.account ?? stageRunner.snapshot()
      return stageReceipt
    } finally {
      unsubscribe()
      try { await stageRunner.close() } catch {}
    }
  }

  async function baseFile(path) {
    try { return (await execFile('git', ['-C', job.worktree, 'show', `${job.baseCommit}:${path}`], { maxBuffer: 16 * 1024 * 1024 })).stdout } catch { return null }
  }

  function proofFileExists(tree, path) {
    try {
      const root = realpathSync(tree)
      const target = realpathSync(join(tree, path))
      const inside = relative(root, target)
      return !inside.startsWith('..') && !isAbsolute(inside) && statSync(target).isFile()
    } catch { return false }
  }

  async function assertPlaybook({ required, declared, checklistText }) {
    const playbookText = await baseFile(`${PLAYBOOKS}/${required}.md`)
    if (playbookText == null) throw refusal(`playbook ${required} is missing from ${PLAYBOOKS}`)
    const conformity = checkPlaybookConformity({ required, declared, playbookText, checklistText })
    if (!conformity.ok) throw refusal(conformity.reason)
  }

  async function writeReviewProof(tree) {
    const proofDir = join(tree, '.builder-home', 'proof')
    await mkdir(proofDir, { recursive: true })
    const { stdout: diff } = await execFile('git', ['-C', job.worktree, 'diff', `${job.baseCommit}..${candidateCommit}`], { maxBuffer: 64 * 1024 * 1024 })
    const proof = {
      'card.json': JSON.stringify(card, null, 2),
      'criteria.md': criteria.map(item => `${item.criterion}. ${item.text}`).join('\n'),
      'checklist.md': checklist ?? '',
      'decisions.tsv': decisions ?? '',
      'changed-files.txt': (job.result.changedFiles ?? []).join('\n'),
      'diff.patch': diff,
      'history.json': JSON.stringify(job.review.history, null, 2),
    }
    for (const [name, text] of Object.entries(proof)) await writeFile(join(proofDir, name), text)
  }

  async function reviewStage() {
    const round = job.review.history.filter(entry => entry.stage === 'review').length + 1
    if (round === 1) await moveLinearCard({ card: cardId, stateName: 'Evidence review', apiKey: linearKey })
    const reviewer = startReviewer()
    job.review.reviewer = reviewer
    await atomicWriteJson(join(jobDir, 'job.json'), job)
    const lastRun = job.review.history.filter(entry => entry.stage !== 'review').at(-1)
    const required = requiredPlaybookForRun({ card, history: job.review.history })
    const declared = declaredPlaybook(checklist)
    if (!checklist?.trim() || (required && declared !== required)) {
      const reason = !checklist?.trim()
        ? 'missing checklist'
        : `checklist follows ${declared ?? 'no declared playbook'}, run requires ${required}`
      await recordReview({ round, reviewer, verdicts: unprovenVerdicts(criteria, reason), passed: false })
      return
    }
    const reviewDir = join(jobDir, `review-${round}`)
    const tree = join(reviewDir, 'tree')
    await rm(reviewDir, { recursive: true, force: true })
    await mkdir(tree, { recursive: true })
    const reviewSettingsPath = join(reviewDir, 'settings.json')
    await atomicWriteJson(reviewSettingsPath, { ...settings, roles: { ...settings.roles, reviewer: reviewer.model } })
    const archive = join(reviewDir, 'tree.tar')
    await execFile('git', ['-C', job.worktree, 'archive', '--format=tar', '-o', archive, candidateCommit])
    await execFile('tar', ['-xf', archive, '-C', tree])
    await writeReviewProof(tree)
    await runStage({
      role: 'reviewer',
      cwd: tree,
      settingsPath: reviewSettingsPath,
      stateDir: join(reviewDir, 'state'),
      hostInstructions: await baseFile(REVIEW_SKILL) ?? '',
      prompt: reviewPrompt({ card, criteria, round }),
      subagents: [],
    })
    const raw = await readOptional(join(tree, '.builder-home', 'review', 'verdicts.json'))
    const outcome = parseVerdicts({ raw, criteria, proofFileExists: path => proofFileExists(tree, path) })
    await recordReview({ round, reviewer, verdicts: outcome.verdicts, passed: outcome.passed })
  }

  function startReviewer() {
    if (!reviewerModel) throw stop('stopped: no reviewer was picked on Start')
    const spec = settings.models[reviewerModel]
    if (spec?.unavailable) throw stop(`stopped: no available reviewer model from another company: ${spec.unavailable}`)
    const reviewer = { model: reviewerModel, company: spec?.company ?? savedRoles.reviewer?.company ?? 'unknown' }
    const orchestratorCompany = settings.models[orchestratorModel]?.company
    const coderCompany = settings.models[coderModel]?.company
    if (reviewer.company === orchestratorCompany || reviewer.company === coderCompany) {
      throw stop(`stopped: reviewer ${reviewer.company} must come from a different company than the orchestrator and the coder`)
    }
    return reviewer
  }

  async function recordReview({ round, reviewer, verdicts, passed }) {
    const entry = { stage: 'review', round, candidateCommit, verdicts, passed }
    job.review.history.push(entry)
    entry.note = formatVerdictNote({ cardId, round, reviewer, candidateCommit, verdicts, passed, next: nextStage(job.review.history) })
    job.linearNote = { card: cardId, message: entry.note, ...(await postLinearComment({ card: cardId, message: entry.note, apiKey: linearKey })) }
    await atomicWriteJson(join(jobDir, 'job.json'), job)
    if (!passed && round === 1) await moveLinearCard({ card: cardId, stateName: 'Remediation', apiKey: linearKey })
  }

  async function remediationStage() {
    const failed = (job.review.history.filter(entry => entry.stage === 'review').at(-1)?.verdicts ?? []).filter(verdict => verdict.verdict !== 'proven')
    await rm(join(builderHome, 'pstack', 'checklist.md'), { force: true })
    await runStage({
      role: 'orchestrator',
      cwd: job.worktree,
      settingsPath: effectiveSettingsPath,
      stateDir,
      hostInstructions: workflowInstructions,
      prompt: remediationPrompt({ card, verdicts: failed }),
    })
    checklist = await readOptional(join(builderHome, 'pstack', 'checklist.md'))
    decisions = await readOptional(join(builderHome, 'pstack', 'decisions.tsv'))
    const { stdout: status } = await execFile('git', ['-C', job.worktree, 'status', '--porcelain'])
    if (status.trim()) {
      await execFile('git', ['-C', job.worktree, 'add', '-A'])
      await execFile('git', ['-C', job.worktree, '-c', 'user.email=builder@example.com', '-c', 'user.name=Builder', 'commit', '-m', `remediate ${cardId}`])
    }
    const { stdout: headOut } = await execFile('git', ['-C', job.worktree, 'rev-parse', 'HEAD'])
    candidateCommit = headOut.trim()
    const { stdout: changedOut } = await execFile('git', ['-C', job.worktree, 'diff', '--name-only', `${job.baseCommit}..${candidateCommit}`])
    const changedFiles = changedOut.split(/\r?\n/).filter(Boolean)
    job.result.candidateCommit = candidateCommit
    job.result.changedFiles = changedFiles
    job.result.internalReview = { ...job.result.internalReview, changedFiles }
    job.review.history.push({ stage: 'remediation', playbook: REQUIRED_PLAYBOOK.remediation, candidateCommit, checklist })
    await atomicWriteJson(join(jobDir, 'job.json'), job)
  }

  async function investigationStage() {
    await rm(join(builderHome, 'pstack', 'checklist.md'), { force: true })
    await runStage({
      role: 'orchestrator',
      cwd: job.worktree,
      settingsPath: effectiveSettingsPath,
      stateDir,
      hostInstructions: workflowInstructions,
      prompt: investigationPrompt({ card, history: job.review.history }),
    })
    checklist = await readOptional(join(builderHome, 'pstack', 'checklist.md'))
    await assertPlaybook({ required: REQUIRED_PLAYBOOK.investigation, declared: declaredPlaybook(checklist), checklistText: checklist })
    const rootCause = (await readOptional(join(builderHome, 'investigation', 'root-cause.md')))?.trim() || null
    const { stdout: status } = await execFile('git', ['-C', job.worktree, 'status', '--porcelain'])
    const tracked = status.split(/\r?\n/).filter(Boolean)
    const entry = { stage: 'investigation', playbook: REQUIRED_PLAYBOOK.investigation, rootCause }
    if (tracked.length) entry.defect = `investigation changed tracked files: ${tracked.join(', ')}`
    job.review.history.push(entry)
    await atomicWriteJson(join(jobDir, 'job.json'), job)
    const note = `${cardId} stopped after two failed evidence reviews. Root cause: ${rootCause ?? 'not recorded'}${entry.defect ? `\n\n${entry.defect}` : ''}`
    job.linearNote = { card: cardId, message: note, ...(await postLinearComment({ card: cardId, message: note, apiKey: linearKey })) }
  }

  async function reviewBeforePublishing() {
    job.review = { reviewer: null, history: [], outcome: null }
    const declared = declaredPlaybook(checklist)
    if (declared) await assertPlaybook({ required: declared, declared, checklistText: checklist })
    await atomicWriteJson(join(jobDir, 'job.json'), job)
    await runner?.close()
    runner = null
    await runReviewLoop()
  }

  async function runReviewLoop() {
    let stage = nextStage(job.review.history)
    while (stage !== 'passed' && stage !== 'stopped') {
      const recorded = job.review.history.length
      if (stage === 'review') await reviewStage()
      else if (stage === 'remediation') await remediationStage()
      else await investigationStage()
      if (job.review.history.length === recorded) throw new Error(`${stage} stage recorded no history`)
      stage = nextStage(job.review.history)
    }
    job.review.outcome = stage
    if (stage === 'passed') {
      job.state = 'ready-for-review'
      job.result.review = job.review
      job.result.downstreamReviewStarted = true
    } else {
      job.state = 'failed'
      job.error = { message: 'stopped after a second failed evidence review', stopped: true }
    }
    await atomicWriteJson(join(jobDir, 'job.json'), job)
  }
  const resumeReview = continueRun && Boolean(job.pause?.reviewStage) && Array.isArray(job.review?.history) && Boolean(job.result?.candidateCommit)
  try {
    if (resumeReview) {
      candidateCommit = job.result.candidateCommit
      checklist = await readOptional(join(jobDir, 'pstack-checklist.md'))
      decisions = await readOptional(join(jobDir, 'pstack-decisions.tsv'))
      job.error = null
      job.pause = null
      await runReviewLoop()
    } else {
    runner = await openRunner({ card: cardId, settingsPath: effectiveSettingsPath, cwd: job.worktree, stateDir, role: 'orchestrator', hostInstructions: workflowInstructions, subagents: helpers })
    globalThis.fetch = observeRequests(globalThis.fetch, requests)
    const unsubscribe = runner.runtime.session.subscribe(e => { if (allowedEventTypes.has(e?.type)) events.push(e) })
    try {
      const instruction = continueRun
        ? `${prompt}\n\nContinue the paused build from the retained worktree and checklist. Do not repeat completed work.`
        : prompt
      const previousThreadId = continueRun ? (job.pause?.threadId ?? undefined) : undefined
      receipt = await runner.run({ prompt: instruction, ...(previousThreadId ? { threadId: previousThreadId } : {}), maxTurns: 100, inactivityMs: SESSION_INACTIVITY_MS })
      receipts.push(receipt)
    } finally {
      unsubscribe()
    }
    threadId = receipt.threadId
    account = receipt.account ?? runner.snapshot()

    const paused = pauseReason(receipt?.result?.status, receipt?.result?.error?.message)
    if (paused) {
      const error = new Error(paused)
      error.pause = paused
      throw error
    }
    if (receipt?.result?.status !== 'completed') throw new Error(receipt?.result?.error?.message ?? `session ended ${receipt?.result?.status ?? 'without a result'}`)

    checklist = await readOptional(join(builderHome, 'pstack', 'checklist.md'))
    decisions = await readOptional(join(builderHome, 'pstack', 'decisions.tsv'))
    const trackedChanges = (await execFile('git', ['-C', job.worktree, 'diff', '--name-only', job.baseCommit])).stdout
    const newFiles = (await execFile('git', ['-C', job.worktree, 'ls-files', '--others', '--exclude-standard'])).stdout
    const pendingChanges = (trackedChanges + '\n' + newFiles).split(/\r?\n/).filter(Boolean)
    internalReview = { ...inspectPstackRun({ events, requests, checklist, decisions, changedFiles: pendingChanges }), effectiveModels: effectiveTable }

    await atomicWriteText(join(jobDir, 'pstack-checklist.md'), checklist ?? '')
    await atomicWriteText(join(jobDir, 'pstack-decisions.tsv'), decisions ?? '')
    await atomicWriteJson(join(jobDir, 'pstack-state.json'), runner.runtime.session.state.get())

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
    const changedFiles = changedOut.split(/\r?\n/).filter(Boolean)
    internalReview = { ...internalReview, changedFiles, unproven: inspectPstackRun({ events, requests, checklist, decisions, changedFiles }).unproven }
    await execFile('git', ['-C', job.worktree, 'merge-base', '--is-ancestor', job.baseCommit, candidateCommit])

    const successResult = {
      card,
      roles: savedRoles,
      actualModels: { orchestrator: orchestratorModel, coder: coderModel, ...(reviewerModel ? { reviewer: reviewerModel } : {}) },
      threadId,
      worktree: job.worktree,
      baseCommit: job.baseCommit,
      candidateCommit,
      account,
      internalReview,
      changedFiles,
      proof: { unproven: internalReview.unproven, next: internalReview.next },
      downstreamReviewStarted: false,
      completedAt: new Date().toISOString(),
      state: 'ready-for-review',
    }
    job.result = successResult
    job.error = null
    job.pause = null
    if (session.machineryProof) {
      job.state = 'ready-for-review'
    } else {
      await reviewBeforePublishing()
    }
    }
  } catch (error) {
    failure = error
    if (error.pause) {
      job.state = 'paused'
      job.error = { message: error.pause }
      const reviewStage = job.review ? nextStage(job.review.history) : null
      if (!reviewStage) job.result = null
      job.pause = { reason: error.pause, message: error.pause, threadId: reviewStage ? null : (receipt?.threadId ?? null), ...(reviewStage ? { reviewStage } : {}), at: new Date().toISOString() }
      const note = await postLinearComment({ card: cardId, message: `${cardId} paused: ${error.pause}. Its work is kept in the run worktree and can be continued.`, apiKey: linearKey })
      job.linearNote = { card: cardId, message: job.error.message, ...note }
    } else if (error.refused) {
      job.state = 'failed'
      job.result = null
      job.error = { message: error.refused, refused: true }
      const note = await postLinearComment({ card: cardId, message: `${cardId} ${error.refused}. No result was saved for this run.`, apiKey: linearKey })
      job.linearNote = { card: cardId, message: error.refused, ...note }
    } else if (error.stopped) {
      job.state = 'failed'
      job.error = { message: error.stopped, stopped: true }
      const note = await postLinearComment({ card: cardId, message: `${cardId} ${error.stopped}.`, apiKey: linearKey })
      job.linearNote = { card: cardId, message: error.stopped, ...note }
    } else {
      job.state = 'failed'
      job.error = { message: error.message, stack: error.stack }
    }
  } finally {
    try {
      await atomicWriteJson(join(jobDir, 'receipt.json'), receipt ?? {})
      await atomicWriteJson(join(jobDir, 'receipts.json'), receipts)
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
