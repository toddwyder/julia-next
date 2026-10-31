import { deepEqual } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS, providerModelId, thinkingForEffort } from '../src/config.mjs'
import { branchFor, normalizeCard, prepareCheckout } from '../src/card.mjs'
import { selectEvidence, evidenceBlock } from '../src/evidence.mjs'
import { parseVerdict, validateVerdict, criteriaFrom, normalizeCriterion } from '../src/verdict.mjs'
import { sessionArgs, sessionEnv } from '../src/session.mjs'
import { buildPrompt, shippingPrompt } from '../src/prompts.mjs'
import { buildSettings, prepareRunDir } from '../src/settings.mjs'

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

test('memory helpers and the free judge are free Command Code models, the final pass is Kimi', () => {
  equal(DEFAULTS.memory, 'mastracode/commandcode/reflection/beam:free')
  equal(DEFAULTS.shippingFree, 'mastracode/commandcode/stealth/glyph-cluster:free')
  equal(DEFAULTS.shippingFinal, 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro')
  equal(providerModelId(DEFAULTS.shippingFree), 'stealth/glyph-cluster:free')
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
})

test('the build prompt carries the card, the evidence duty and no hand-off', () => {
  const prompt = buildPrompt({ card, branch: 'runner/card-900' })
  match(prompt, /JUL-900/)
  match(prompt, /runner\/card-900/)
  match(prompt, /Prove It Works: <the criterion in the card's words>/)
  match(prompt, /unattended/)
  match(prompt, /playbook its table names for this card's label \(Feature\)/)
  match(prompt, /Do not merge the pull request and do not move the card/)
})

test('the shipping prompt names the verdict file, the model and the criterion duty', () => {
  const prompt = shippingPrompt({ card, evidence: 'EVIDENCE', verifierModel: 'm', verdictPath: '/v.json', final: false })
  match(prompt, /\/v\.json/)
  match(prompt, /EVIDENCE/)
  match(prompt, /the first Shipping pass and it runs on m/)
  match(prompt, /A criterion judged from a description alone is a FAIL/)
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
  const settings = buildSettings(baseSettings, { buildModel: 'mastracode/commandcode/stealth/glyph-cluster:free', memoryModel: 'mastracode/commandcode/reflection/beam:free', helperModel: 'mastracode/commandcode/reflection/beam:free' })
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

  const prepared = prepareRunDir({ runDir, authSource: source, memoryModel: 'mastracode/commandcode/reflection/beam:free', buildModel: 'mastracode/commandcode/reflection/beam:free', helperModel: 'mastracode/commandcode/reflection/beam:free' })
  equal(prepared.settingsPath, join(runDir, 'app-data', 'settings.json'))
  equal(JSON.parse(readFileSync(prepared.settingsPath, 'utf8')).models.modeDefaults.memory, 'mastracode/commandcode/reflection/beam:free')
  equal(readFileSync(join(runDir, 'app-data', 'auth.json'), 'utf8'), '{"accounts":[]}\n')
})

function match(text, pattern) {
  if (!pattern.test(text)) throw new Error(`expected ${pattern} in:\n${text}`)
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
