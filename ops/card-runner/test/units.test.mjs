import { deepEqual } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CONFIG_PATH, providerModelId, readRunnerConfig, thinkingForEffort } from '../src/config.mjs'
import { branchFor, normalizeCard, prepareAdoptedCheckout, prepareCheckout, publishPull } from '../src/card.mjs'
import { missingEvidence, readBuildDone, readPullDraft, writeBuildHandover } from '../src/handover.mjs'
import { selectEvidence, evidenceBlock } from '../src/evidence.mjs'
import { parseVerdict, validateVerdict, criteriaFrom, normalizeCriterion } from '../src/verdict.mjs'
import { sessionArgs, sessionEnv } from '../src/session.mjs'
import { buildBackPrompt, buildPrompt, shippingPrompt } from '../src/prompts.mjs'
import { buildSettings, prepareRunDir } from '../src/settings.mjs'
import { cardOfRun, parseArgs, runDirFor } from '../run.mjs'

const card = {
  identifier: 'JUL-900',
  title: 'A scratch card',
  description: 'Outcome: something.\n\nAcceptance criteria:\n- The first thing works.\n- The second thing works.\n',
  url: 'https://linear.app/x/issue/JUL-900',
  labels: ['Feature'],
}

const verdict = {
  juliaShippingVerdict: 1,
  card: 'JUL-900',
  head: 'abc1234',
  verdict: 'PASS',
  builder: 'toddwyder',
  verifier: 'mastracode/commandcode/stealth/glyph-cluster:free',
  criteria: [
    { criterion: 'The first thing works.', verdict: 'PASS', note: 'ran npm test, 3 passed' },
    { criterion: 'The second thing works.', verdict: 'PASS', note: 'opened /start and saw the row' },
  ],
}

test('every runner model comes from the dashboard config file', () => {
  check(CONFIG_PATH.endsWith('/dashboard/config/defaults.json'))

  const config = readRunnerConfig()
  equal(config.configPath, CONFIG_PATH)
  equal(config.models.shipping, 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro')
  equal(config.models.build, 'mastracode/commandcode/reflection/beam:free')
  equal(config.models.memory, config.models.build)
  equal(config.models.helper, config.models.build)
  equal(config.effort, 'large')
  equal(config.evidenceAttempts, 2)
  equal(config.timeoutMs, 5_400_000)
  equal(providerModelId(config.models.shipping), 'moonshotai/Kimi-K3.1-Pro')
})

test('the runner config is read from disk each time, so an edit changes the next run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-runner-config-'))
  const path = join(dir, 'defaults.json')
  writeFileSync(path, JSON.stringify({
    mainSession: 'openai/gpt-6.1-sol',
    shipping: 'anthropic/claude-opus-5-5',
    effort: 'medium',
    runner: { build: 'a/build', memory: 'a/memory', helper: 'a/helper', evidenceAttempts: 3, timeoutMs: 1000 },
  }))
  const first = readRunnerConfig({ configPath: path })
  equal(first.models.shipping, 'anthropic/claude-opus-5-5')
  equal(first.models.memory, 'a/memory')
  equal(first.effort, 'medium')

  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), shipping: 'someone/else' }))
  equal(readRunnerConfig({ configPath: path }).models.shipping, 'someone/else')
})

test('a config file with no shipping model is refused instead of guessing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-runner-config-'))
  const path = join(dir, 'defaults.json')
  writeFileSync(path, JSON.stringify({ mainSession: 'openai/gpt-6.1-sol' }))
  throws(() => readRunnerConfig({ configPath: path }), /shipping/)
  throws(() => readRunnerConfig({ configPath: join(dir, 'missing.json') }), /could not be read/)
})

test('the command line takes a card, the run switches, and refuses anything else', () => {
  deepEqual(parseArgs(['JUL-901']), { card: 'JUL-901' })
  deepEqual(parseArgs(['jul-901', '--repo', '/r', '--ship-only', '--branch', 'b']), { card: 'JUL-901', repoDir: '/r', shipOnly: true, branch: 'b' })
  deepEqual(parseArgs(['--approve', 'JUL-901-1']), { approve: 'JUL-901-1' })
  deepEqual(parseArgs(['--repost', 'JUL-901-1', '--run-dir', '/d']), { repost: 'JUL-901-1', runDir: '/d' })
  throws(() => parseArgs([]), /usage/)
  throws(() => parseArgs(['JUL-901', '--model', 'x']), /unknown argument/)
  throws(() => parseArgs(['not-a-card']), /not a card id/)
  throws(() => parseArgs(['JUL-901', 'JUL-902']), /unexpected argument/)
})

test('a run id names the card and so the run folder', () => {
  equal(cardOfRun('JUL-901-1761900000000'), 'JUL-901')
  throws(() => cardOfRun('nope'), /not a card run id/)
  equal(runDirFor({ runId: 'JUL-901-1' }), '/var/lib/julia-dashboard/state/runs/JUL-901')
  equal(runDirFor({ runId: 'JUL-901-1', runDir: '/d' }), '/d')
})

test('effort names translate to thinking levels', () => {
  deepEqual(['small', 'medium', 'large', 'unlimited'].map(thinkingForEffort), ['low', 'medium', 'high', 'max'])
  equal(thinkingForEffort('nonsense'), 'high')
})

test('a card branch is named after the card number', () => {
  equal(branchFor(card), 'runner/card-900')
  equal(branchFor({ identifier: 'JUL-1' }), 'runner/card-1')
})

test('a Linear issue loses its GraphQL wrappers', () => {
  deepEqual(normalizeCard({ id: '1', identifier: 'JUL-9', title: 't', description: null, url: 'u', labels: { nodes: [{ name: 'Feature' }] }, comments: { nodes: [{ id: 'c' }] } }), {
    id: '1', identifier: 'JUL-9', title: 't', description: '', url: 'u', labels: ['Feature'], comments: [{ id: 'c' }],
  })
})

test('a checkout is rebuilt from main, clearing a leftover worktree first', () => {
  const calls = []
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '))
    if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('no such worktree')
    return ''
  }
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-checkout-'))
  const prepared = prepareCheckout({ repoDir: '/repo', card, runDir, exec })
  equal(prepared.branch, 'runner/card-900')
  equal(prepared.checkout, join(runDir, 'checkout'))
  deepEqual(calls, [
    'git worktree remove --force ' + join(runDir, 'checkout'),
    'git branch -D runner/card-900',
    'git fetch origin main',
    'git worktree add -B runner/card-900 ' + join(runDir, 'checkout') + ' origin/main',
  ])
})

test('the session is told the model, the output format and the settings file', () => {
  const args = sessionArgs({ model: 'm', thinkingLevel: 'low', title: 't', timeoutMs: 90 * 60 * 1000, settingsPath: '/s.json' })
  deepEqual(args, ['--prompt', '-', '--model', 'm', '--thinking-level', 'low', '--title', 't', '--output', 'json', '--permission-mode', 'auto', '--settings', '/s.json', '--timeout', '5400'])
})

test('a session env never carries colour and always points at its own storage', () => {
  const env = sessionEnv({ CLICOLOR_FORCE: '1', GH_FORCE_TTY: '1', FORCE_COLOR: '1', PATH: '/bin', LINEAR_API_KEY: 'k' }, { appData: '/a', tracePath: '/t.duckdb' })
  deepEqual(env, { PATH: '/bin', LINEAR_API_KEY: 'k', NO_COLOR: '1', CLICOLOR: '0', MASTRA_APP_DATA_DIR: '/a', MASTRA_OBSERVABILITY_DB_PATH: '/t.duckdb' })
})

test('evidence is whatever the build posted after the run started', () => {
  const comments = [
    { id: 'old', createdAt: '2026-10-01T00:00:00Z', body: 'older', user: { name: 'a' } },
    { id: 'new', createdAt: '2026-10-31T00:00:10Z', body: 'Prove It Works: x', user: { name: 'b' } },
  ]
  deepEqual(selectEvidence(comments, '2026-10-31T00:00:00Z'), [{ id: 'new', author: 'b', body: 'Prove It Works: x', createdAt: '2026-10-31T00:00:10Z' }])
  equal(evidenceBlock([]), 'The build posted no evidence comment on the card.')
  match(evidenceBlock([{ id: 'c-1', author: 'b', body: 'Prove It Works: x', createdAt: '2026-10-31T00:00:10Z' }]), /\(Linear comment c-1\)/)
})

test('an adopted checkout keeps the branch the build pushed', () => {
  const calls = []
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '))
    if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('no such worktree')
    return ''
  }
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-adopt-'))
  const prepared = prepareAdoptedCheckout({ repoDir: '/repo', branch: 'feat/jul-900-thing', runDir, exec })
  equal(prepared.branch, 'feat/jul-900-thing')
  deepEqual(calls, [
    'git worktree remove --force ' + join(runDir, 'checkout'),
    'git fetch origin feat/jul-900-thing',
    'git worktree add --detach ' + join(runDir, 'checkout') + ' origin/feat/jul-900-thing',
  ])
})

test('the runner publishes the title and description the build wrote', () => {
  let created = false
  const calls = []
  const bodies = []
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '))
    if (args[0] === 'pr' && args[1] === 'body-file') throw new Error('unexpected')
    const bodyIndex = args.indexOf('--body-file')
    if (bodyIndex > -1) bodies.push(readFileSync(args[bodyIndex + 1], 'utf8'))
    if (args[0] === 'pr' && args[1] === 'list') {
      if (!created) return '[]'
      return JSON.stringify([{ number: 12, headRefOid: 'abc1234', url: 'https://github.com/o/r/pull/12', title: 'Do the things (JUL-900)', commits: [{ authors: [{ login: 'toddwyder' }] }] }])
    }
    if (args[0] === 'pr' && args[1] === 'create') { created = true; return '' }
    throw new Error(`unexpected: ${args.join(' ')}`)
  }

  const published = publishPull({ repoDir: '/repo', branch: 'runner/card-900', title: 'Do the things (JUL-900)', body: 'What changed.\n\nCard: JUL-900\n', exec })
  equal(published.number, 12)
  equal(published.head, 'abc1234')
  equal(published.builder, 'toddwyder')
  match(calls[1], /^gh pr create --head runner\/card-900 --base main --title Do the things \(JUL-900\) --body-file /)
  deepEqual(bodies, ['What changed.\n\nCard: JUL-900\n'])
})

test('an existing pull request is edited, never opened twice', () => {
  const calls = []
  const sent = []
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '))
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 12, headRefOid: 'abc1234', url: 'https://github.com/o/r/pull/12', title: 'old', commits: [] }])
    const inputIndex = args.indexOf('--input')
    if (inputIndex > -1) { sent.push(readFileSync(args[inputIndex + 1], 'utf8')); return '' }
    throw new Error(`unexpected: ${args.join(' ')}`)
  }
  const published = publishPull({ repoDir: '/repo', branch: 'feat/x', title: 'New title (JUL-900)', body: 'Card: JUL-900\n', exec })
  equal(published.number, 12)
  match(calls[1], /^gh api --method PATCH repos\/o\/r\/pulls\/12 --input /)
  deepEqual(JSON.parse(sent[0]), { title: 'New title (JUL-900)', body: 'Card: JUL-900\n' })
})

test('a build hands over its branch, its words and the file that says it is done', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-handover-'))
  writeBuildHandover({ runDir, card: 'JUL-900', branch: 'runner/card-900', head: 'abc1234', startedAt: '2026-10-31T00:00:00Z' })
  deepEqual(readBuildDone({ runDir, card: 'JUL-900' }), { card: 'JUL-900', branch: 'runner/card-900', head: 'abc1234', startedAt: '2026-10-31T00:00:00Z' })

  const empty = mkdtempSync(join(tmpdir(), 'card-runner-handover-'))
  throws(() => readBuildDone({ runDir: empty, card: 'JUL-900' }), /did not say it was done/)

  writeBuildHandover({ runDir: empty, card: 'JUL-901', branch: 'b', head: 'abc1234' })
  throws(() => readBuildDone({ runDir: empty, card: 'JUL-900' }), /JUL-901/)
})

test('a pull request description without the card line is refused', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-draft-'))
  mkdirSync(join(runDir, 'pr'))
  writeFileSync(join(runDir, 'pr/title.txt'), 'Do the things (JUL-900)\n')
  writeFileSync(join(runDir, 'pr/body.md'), 'What changed.\n\nCard: JUL-900\n')
  deepEqual(readPullDraft({ runDir, card: 'JUL-900' }), { title: 'Do the things (JUL-900)', body: 'What changed.\n\nCard: JUL-900' })

  writeFileSync(join(runDir, 'pr/body.md'), 'What changed.\n')
  throws(() => readPullDraft({ runDir, card: 'JUL-900' }), /Card: JUL-900/)
})

test('an acceptance criterion without its own evidence comment is named as missing', () => {
  const criteria = ['The first thing works.', 'The `second` thing works.']
  const evidence = [{ id: 'c-1', author: 'build', createdAt: '2026-10-31T00:00:10Z', body: 'Prove It Works: the first thing works.\nran npm test' }]
  deepEqual(missingEvidence(evidence, criteria), ['The `second` thing works.'])

  const both = [...evidence, { id: 'c-2', author: 'build', createdAt: '2026-10-31T00:00:20Z', body: 'Prove It Works: The second thing works.\nopened the page' }]
  deepEqual(missingEvidence(both, criteria), [])
  deepEqual(missingEvidence([{ id: 'c-3', author: 'build', createdAt: '2026-10-31T00:00:30Z', body: 'notes about the first thing works' }], criteria), criteria)
})

test('the build prompt carries the card, the handover files and no hand-off', () => {
  const prompt = buildPrompt({ card, branch: 'runner/card-900', runDir: '/state/JUL-900' })
  match(prompt, /JUL-900/)
  match(prompt, /runner\/card-900/)
  match(prompt, /Prove It Works: <the criterion in the card's words>/)
  match(prompt, /unattended/)
  match(prompt, /playbook its table names for this card's label \(Feature\)/)
  match(prompt, /Write the title to \/state\/JUL-900\/pr\/title\.txt/)
  match(prompt, /Card: JUL-900/)
  match(prompt, /Write it last/) 
  match(prompt, /\/state\/JUL-900\/build-done\.json/)
  match(prompt, /Do not open or edit the pull request yourself/)
  match(prompt, /Do not merge the pull request and do not move the card/)
})

test('the shipping prompt names the verdict file, the model, the pull request and the criterion duty', () => {
  const prompt = shippingPrompt({ card, evidence: 'EVIDENCE', verifierModel: 'm', verdictPath: '/v.json', pull: { number: 12, url: 'https://github.com/o/r/pull/12', head: 'abc1234' } })
  match(prompt, /\/v\.json/)
  match(prompt, /EVIDENCE/)
  match(prompt, /This Shipping pass runs on m\./)
  match(prompt, /A criterion judged from a description alone is a FAIL/)
  match(prompt, /The pull request to judge is https:\/\/github\.com\/o\/r\/pull\/12 \(number 12\), and its head commit at the time this run started was abc1234/)
  match(prompt, /node scripts\/linear-cli\.mjs comments JUL-900/)
  match(prompt, /Every FAIL note carries its reason in three parts/)
  match(prompt, /Copy each line character for character/)
  match(prompt, /1\. The first thing works\.\n2\. The second thing works\./)
})

test('a build sent back is given the criteria it has not shown evidence for', () => {
  const prompt = buildBackPrompt({ card, branch: 'runner/card-900', runDir: '/state/JUL-900', missing: ['The second thing works.'] })
  match(prompt, /no .*Prove It Works:\W comment/)
  match(prompt, /The second thing works\./)
  match(prompt, /Prove It Works: <the criterion in the card's words>/)
  match(prompt, /runner\/card-900/)
  match(prompt, /\/state\/JUL-900\/build-done\.json/)
  match(prompt, /Do not open or edit the pull request/)
})

test('a verdict is accepted only when it answers this card, this head and this model', () => {
  equal(validateVerdict(verdict, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) }).ok, true)
  const other = structuredClone(verdict)
  other.head = 'def5678'
  const wrongHead = validateVerdict(other, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier })
  equal(wrongHead.ok, false)
  match(wrongHead.errors.join(' '), /head is def5678/)

  const sameName = structuredClone(verdict)
  sameName.verifier = sameName.builder
  equal(parseVerdict(JSON.stringify(sameName)).ok, false)

  const missing = structuredClone(verdict)
  missing.criteria = missing.criteria.slice(0, 1)
  const gap = validateVerdict(missing, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) })
  equal(gap.ok, false)
  match(gap.errors.join(' '), /no verdict for: The second thing works/)

  const quoted = structuredClone(verdict)
  quoted.criteria[1].criterion = 'The second thing works when a person opens it'
  equal(validateVerdict(quoted, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) }).ok, true)

  // A judge that writes each criterion in its own shorter words still answers
  // the card, and what the runner posts carries the card's wording.
  const shortened = structuredClone(verdict)
  shortened.criteria[0].criterion = 'the first thing works'
  shortened.criteria[1].criterion = 'second thing works'
  const accepted = validateVerdict(shortened, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) })
  equal(accepted.ok, true)
  equal(accepted.verdict.criteria.map((item) => item.criterion).join('|'), criteriaFrom(card.description).join('|'))
  equal(accepted.verdict.criteria[1].note, shortened.criteria[1].note)

  const extra = structuredClone(verdict)
  extra.criteria.push({ criterion: 'Something else entirely.', verdict: 'PASS', note: 'Saw it.' })
  const tooMany = validateVerdict(extra, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) })
  equal(tooMany.ok, false)
  match(tooMany.errors.join(' '), /answered a criterion the card does not ask: Something else entirely/)

  const readably = structuredClone(verdict)
  readably.verifier = 'Glyph Cluster'
  equal(validateVerdict(readably, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier, expectedCriteria: criteriaFrom(card.description) }).ok, true)

  const anotherJudge = structuredClone(verdict)
  anotherJudge.verifier = 'Kimi K3.1 Pro'
  equal(validateVerdict(anotherJudge, { card: 'JUL-900', head: 'abc1234', verifier: verdict.verifier }).ok, false)

  // Markdown in a criterion must not decide whether the words match.
  equal(normalizeCriterion('A new file `ops/x.md` explains it'), normalizeCriterion('A new file ops/x.md explains it'))
})

test('a PASS with a failing criterion, and a FAIL with none, are both refused', () => {
  const badPass = structuredClone(verdict)
  badPass.criteria[0].verdict = 'FAIL'
  match(parseVerdict(JSON.stringify(badPass)).errors.join(' '), /a PASS verdict has a criterion that did not pass/)

  const badFail = structuredClone(verdict)
  badFail.verdict = 'FAIL'
  match(parseVerdict(JSON.stringify(badFail)).errors.join(' '), /a FAIL verdict has no failing criterion/)
})

test('acceptance criteria are read from the card in its own words', () => {
  deepEqual(criteriaFrom(card.description), ['The first thing works.', 'The second thing works.'])
  deepEqual(criteriaFrom(''), [])
})

const baseSettings = {
  onboarding: { completedAt: '2026-10-26T11:41:40Z' },
  models: { activeModelPackId: 'custom:sol/deepseek', modeDefaults: { build: 'openai/gpt-6.1-sol' }, observerModelOverride: 'old' },
  customProviders: [{ name: 'CommandCode', url: 'https://example.test', apiKey: 'key', models: ['moonshotai/Kimi-K3.1-Pro'] }],
  customModelPacks: [{ name: 'julia', models: {} }],
  preferences: { yolo: false },
}

test('every memory helper is pinned to the free model, and the provider can name it', () => {
  const settings = buildSettings(baseSettings, { buildModel: 'mastracode/commandcode/stealth/glyph-cluster:free', memoryModel: 'mastracode/commandcode/reflection/beam:free', helperModel: 'mastracode/commandcode/reflection/beam:free', shippingModel: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro' })
  equal(settings.models.observerModelOverride, 'mastracode/commandcode/reflection/beam:free')
  equal(settings.models.observerModelSelection, 'mastracode/commandcode/reflection/beam:free')
  equal(settings.models.reflectorModelOverride, 'mastracode/commandcode/reflection/beam:free')
  equal(settings.models.reflectorModelSelection, 'mastracode/commandcode/reflection/beam:free')
  equal(settings.models.modeDefaults.memory, 'mastracode/commandcode/reflection/beam:free')
  equal(settings.customModelPacks[0].models.memory, 'mastracode/commandcode/reflection/beam:free')
  for (const id of ['moonshotai/Kimi-K3.1-Pro', 'stealth/glyph-cluster:free', 'reflection/beam:free']) {
    if (!settings.customProviders[0].models.includes(id)) throw new Error(`provider cannot name ${id}`)
  }
  equal(settings.customProviders[0].apiKey, 'key')
  deepEqual(settings.customModelPacks.map((pack) => pack.name), ['card-runner', 'julia'])
})

test('a run keeps its own settings in its own app-data folder', () => {
  const source = mkdtempSync(join(tmpdir(), 'card-runner-auth-'))
  writeFileSync(join(source, 'auth.json'), '{"accounts":[]}\n')
  writeFileSync(join(source, 'settings.json'), JSON.stringify(baseSettings))
  const runDir = mkdtempSync(join(tmpdir(), 'card-runner-run-'))
  mkdirSync(join(runDir, 'app-data'), { recursive: true })

  const prepared = prepareRunDir({ runDir, authSource: source, memoryModel: 'mastracode/commandcode/reflection/beam:free', buildModel: 'mastracode/commandcode/reflection/beam:free', helperModel: 'mastracode/commandcode/reflection/beam:free', shippingModel: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro' })
  equal(prepared.settingsPath, join(runDir, 'app-data', 'settings.json'))
  equal(JSON.parse(readFileSync(prepared.settingsPath, 'utf8')).models.modeDefaults.memory, 'mastracode/commandcode/reflection/beam:free')
  equal(readFileSync(join(runDir, 'app-data', 'auth.json'), 'utf8'), '{"accounts":[]}\n')
})

function check(value) {
  if (!value) throw new Error('expected a truthy value')
}

function match(text, pattern) {
  if (!pattern.test(text)) throw new Error(`expected ${pattern} in:\n${text}`)
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function throws(fn, pattern) {
  try {
    fn()
  } catch (error) {
    if (!pattern.test(error.message)) throw new Error(`expected ${pattern}, got ${error.message}`)
    return
  }
  throw new Error(`expected a throw matching ${pattern}`)
}
