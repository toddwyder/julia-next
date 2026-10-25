import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { playbookSteps } from '../evidence-review.mjs'

const runnerDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(runnerDir, '..', '..')
const playbook = name => readFileSync(join(repoRoot, '.agents/skills/poteto-mode/playbooks', `${name}.md`), 'utf8')
const checklistFor = (title, name) => `Playbook: ${title}\n\n${playbookSteps(playbook(name)).map((step, index) => `- [x] ${index + 1}. ${step}`).join('\n')}\n`

const card = {
  identifier: 'JUL-252',
  title: 'Evidence review',
  description: '## Outcome\n\nReviewed.\n\n## Acceptance criteria\n\n* First criterion.\n* Second criterion.\n* Third criterion.',
}
const verdicts = (verdict, proofFile = '.builder-home/proof/diff.patch') => JSON.stringify({ verdicts: [1, 2, 3].map(criterion => ({ criterion, verdict, proofFile, reason: `${verdict} by fixture` })) })
const reviewFile = verdict => ({ '.builder-home/review/verdicts.json': verdicts(verdict) })

async function runWorker(script, env = {}, continueAfterPause = false) {
  const dir = mkdtempSync(join(tmpdir(), 'jul252-worker-'))
  const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim()
  const worktree = join(dir, 'worktree')
  mkdirSync(worktree)
  for (const path of ['.agents/skills/poteto-mode', '.agents/skills/adversarial-review']) cpSync(join(repoRoot, path), join(worktree, path), { recursive: true })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  const jobDir = join(dir, 'jobs', 'run-1')
  mkdirSync(jobDir, { recursive: true })
  const settingsPath = join(dir, 'settings.json')
  writeFileSync(settingsPath, JSON.stringify({
    ledgerPath: join(dir, 'cards.sqlite'),
    roles: { orchestrator: 'anthropic/claude-haiku-5-5', coder: 'commandcode/deepseek/deepseek-v4.1-flash' },
    reviewers: ['anthropic/claude-haiku-5-5', 'openai/gpt-6-sol'],
  }))
  writeFileSync(join(jobDir, 'job.json'), JSON.stringify({
    runId: 'run-1', state: 'running', worktree, baseCommit, settingsPath, workerPid: null,
    snapshot: { runId: 'run-1', card, roles: { orchestrator: 'anthropic/claude-haiku-5-5', coder: 'commandcode/deepseek/deepseek-v4.1-flash' } },
  }))
  const scriptPath = join(dir, 'script.json')
  const logPath = join(dir, 'log.jsonl')
  writeFileSync(scriptPath, JSON.stringify(script))
  writeFileSync(logPath, '')
  let output = ''
  const runOnce = async extra => {
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fake-runtime/hooks.mjs', import.meta.url)), join(runnerDir, 'worker.mjs'), '--job-dir', jobDir, ...extra], {
      env: { PATH: process.env.PATH, FAKE_SCRIPT: scriptPath, FAKE_LOG: logPath, LINEAR_API_KEY: 'fixture-key', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data })
    await new Promise(resolve => child.on('close', resolve))
    return JSON.parse(readFileSync(join(jobDir, 'job.json'), 'utf8'))
  }
  let job = await runOnce([])
  const paused = job
  if (continueAfterPause) job = await runOnce(['--continue'])
  const log = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  rmSync(dir, { recursive: true, force: true })
  return { job, log, output, paused }
}

const opened = log => log.filter(entry => entry.kind === 'open')
const comments = log => log.filter(entry => entry.kind === 'linear' && entry.query.includes('commentCreate')).map(entry => entry.variables.input.body)
const moves = log => log.filter(entry => entry.kind === 'linear' && entry.query.includes('issueUpdate')).map(entry => entry.variables.stateId)
const build = { files: { '.builder-home/pstack/checklist.md': checklistFor('Feature', 'feature'), 'feature.txt': 'built\n' } }

test('a finished build is reviewed by another company with no one pressing anything, and a pass is saved with its verdicts', async () => {
  const { job, log, output } = await runWorker([build, { files: reviewFile('proven') }])
  assert.equal(job.state, 'ready-for-review', output)
  assert.equal(job.result.downstreamReviewStarted, true)
  const reviewer = opened(log)[1]
  assert.equal(reviewer.role, 'reviewer')
  assert.equal(reviewer.model, 'openai/gpt-6-sol')
  assert.deepEqual(reviewer.subagents, [])
  assert.match(reviewer.instructions, /adversarial-review/)
  assert.deepEqual(job.review.history.map(entry => [entry.stage, entry.passed]), [['review', true]])
  assert.deepEqual(moves(log), ['s-review'])
  const [note] = comments(log)
  assert.match(note, /Evidence review 1 for JUL-252: passed/)
  assert.equal(note.match(/\*\*proven\*\*/g).length, 3)
  assert.match(note, /proof: \.builder-home\/proof\/diff\.patch/)
})

test('a reviewer claim resting on a proof file that does not exist is recorded unproven', async () => {
  const missingProof = { '.builder-home/review/verdicts.json': verdicts('proven', 'proof/invented.png') }
  const { job, log } = await runWorker([build, { files: missingProof }, { files: { '.builder-home/pstack/checklist.md': checklistFor('Bug fix', 'bug-fix') } }, { files: reviewFile('proven') }])
  assert.equal(job.review.history[0].passed, false)
  assert.ok(job.review.history[0].verdicts.every(entry => entry.verdict === 'unproven' && /proof file not found/.test(entry.reason)))
  assert.match(comments(log)[0], /\*\*unproven\*\*/)
})

test('two failed reviews run one Bug fix remediation, then an Investigation, then stop the card', async () => {
  const { job, log, output } = await runWorker([
    build,
    { files: reviewFile('unproven') },
    { files: { '.builder-home/pstack/checklist.md': checklistFor('Bug fix', 'bug-fix'), 'feature.txt': 'fixed\n' } },
    { files: reviewFile('wrong thing tested') },
    { files: { '.builder-home/pstack/checklist.md': checklistFor('Investigation', 'investigation'), '.builder-home/investigation/root-cause.md': 'The proof tested the wrong page.' } },
  ])
  assert.equal(job.state, 'failed', output)
  assert.equal(job.error.stopped, true)
  assert.deepEqual(job.review.history.map(entry => entry.stage), ['review', 'remediation', 'review', 'investigation'])
  assert.notEqual(job.review.history[2].candidateCommit, job.review.history[0].candidateCommit)
  assert.deepEqual(opened(log).map(entry => entry.role), ['orchestrator', 'reviewer', 'orchestrator', 'reviewer', 'orchestrator'])
  assert.deepEqual(moves(log), ['s-review', 's-remediation'])
  const notes = comments(log)
  assert.equal(notes.length, 3)
  assert.match(notes[0], /failed[\s\S]*\*\*unproven\*\*[\s\S]*Next: remediation/)
  assert.match(notes[1], /Evidence review 2[\s\S]*\*\*wrong thing tested\*\*[\s\S]*Next: investigation/)
  assert.match(notes[2], /stopped after two failed evidence reviews. Root cause: The proof tested the wrong page\./)
})

test('a build whose checklist skips its declared playbook steps is refused before any review and saves no result', async () => {
  const partial = { files: { '.builder-home/pstack/checklist.md': 'Playbook: Feature\n\n- [x] 1. `how` over the affected subsystem.\n', 'feature.txt': 'built\n' } }
  const { job, log } = await runWorker([partial])
  assert.equal(job.state, 'failed')
  assert.equal(job.result, null)
  assert.equal(job.error.refused, true)
  assert.match(job.error.message, /missing playbook step 2/)
  assert.deepEqual(opened(log).map(entry => entry.role), ['orchestrator'])
})

test('a remediation run whose checklist follows a playbook other than Bug fix is refused', async () => {
  const { job, log } = await runWorker([
    build,
    { files: reviewFile('unproven') },
    { files: { '.builder-home/pstack/checklist.md': checklistFor('Feature', 'feature'), 'feature.txt': 'fixed\n' } },
  ])
  assert.equal(job.state, 'failed')
  assert.equal(job.result, null)
  assert.equal(job.error.refused, true)
  assert.match(job.error.message, /checklist follows feature, run requires bug-fix/)
  assert.equal(opened(log).length, 3)
})

test('with no signed-in reviewer from another company the card stops with a note instead of reviewing itself', async () => {
  const { job, log } = await runWorker([build], { FAKE_OPENAI_SIGNED_OUT: '1' })
  assert.equal(job.state, 'failed')
  assert.equal(job.error.stopped, true)
  assert.deepEqual(opened(log).map(entry => entry.role), ['orchestrator'])
  assert.match(comments(log)[0], /no reviewer model from another company/)
})

test('a reviewer citing a proof file that links outside the exported tree is recorded unproven', async () => {
  const escape = { files: reviewFile('proven'), links: { 'escape.md': '/etc/hostname' } }
  escape.files['.builder-home/review/verdicts.json'] = verdicts('proven', 'escape.md')
  const { job } = await runWorker([build, escape, { files: { '.builder-home/pstack/checklist.md': checklistFor('Bug fix', 'bug-fix') } }, { files: reviewFile('proven') }])
  assert.ok(job.review.history[0].verdicts.every(entry => entry.verdict === 'unproven'))
})

test('a review that pauses keeps the saved build and its history, and continuing resumes the loop without resetting the review count', async () => {
  const { job, paused, log, output } = await runWorker([
    build,
    { files: reviewFile('unproven') },
    { status: 'max_turns' },
    { files: { '.builder-home/pstack/checklist.md': checklistFor('Bug fix', 'bug-fix'), 'feature.txt': 'fixed\n' } },
    { files: reviewFile('unproven') },
    { files: { '.builder-home/pstack/checklist.md': checklistFor('Investigation', 'investigation'), '.builder-home/investigation/root-cause.md': 'Root.' } },
  ], {}, true)
  assert.equal(paused.state, 'paused')
  assert.equal(paused.pause.reviewStage, 'remediation')
  assert.ok(paused.result.candidateCommit)
  assert.deepEqual(paused.review.history.map(entry => entry.stage), ['review'])
  assert.equal(job.state, 'failed', output)
  assert.equal(job.error.stopped, true)
  assert.deepEqual(job.review.history.map(entry => entry.stage), ['review', 'remediation', 'review', 'investigation'])
  assert.equal(opened(log).filter(entry => entry.role === 'reviewer').length, 2)
})
