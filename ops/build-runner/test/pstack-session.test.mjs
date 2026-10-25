import test from 'node:test'
import assert from 'node:assert/strict'
import { createPstackSession, inspectPstackRun, resolveModelKey } from '../pstack-session.mjs'

const beam = 'commandcode/reflection/beam:free'
const deepseek = 'commandcode/deepseek/deepseek-v4.1-flash'
const sol = 'openai/gpt-6-sol'
const models = Object.fromEntries([beam, deepseek, sol].map(id => [id, { wireModel: id }]))
const snapshot = { card: { identifier: 'JUL-253', title: 'Model split', description: 'Ship the agreed model split.' }, roles: { orchestrator: sol, coder: deepseek } }
const table = `feature, refactoring: ${deepseek}\nmain session: ${sol}\nhardest tasks: ${sol}\ninterrogate reviewers: ${sol}, ${deepseek}\n`

test('normal session keeps the configured split and only referenced models', () => {
  const session = createPstackSession({ models }, snapshot, table)
  assert.equal(session.orchestratorModel, sol)
  assert.equal(session.coderModel, deepseek)
  assert.equal(session.machineryProof, false)
  assert.deepEqual(session.helpers.map(h => h.defaultModelId), [deepseek, sol])
  assert.deepEqual(session.builderModels, [deepseek, sol])
  assert.equal(new Set(session.helpers.map(h => h.id)).size, 2)
  assert.ok(session.helpers.every(h => h.maxSteps === 100))
  assert.match(session.prompt, /follow.*poteto-mode/i)
  assert.match(session.prompt, /Start the checklist with the line "Playbook: <name>" naming the playbook you follow\./)
  assert.match(session.prompt, /Ship the agreed model split\./)
  assert.doesNotMatch(session.prompt, /delegate|cap-check|REVIEW_AND_PROOF/)
  assert.equal(session.pstackModels, table)
  assert.match(session.hostInstructions, /\.builder-home\/pstack\/checklist\.md/)
  assert.match(session.hostInstructions, /\.builder-home\/pstack\/decisions\.tsv/)
  assert.match(session.hostInstructions, /evidence review judges the result/i)
  assert.doesNotMatch(session.hostInstructions, /two-model|panel|self-check|both configured|coder task/i)
})

test('a route disambiguates a model id that two providers publish', () => {
  const shared = { wireModel: 'claude-opus-5-5', route: 'claude', service: 'Claude subscription', company: 'Anthropic', wire: 'messages' }
  const settings = {
    models: {
      'anthropic/claude-opus-5-5': shared,
      'commandcode/claude-opus-5-5': { ...shared, route: 'commandcode', service: 'CommandCode', wire: 'messages' },
    },
  }
  const selection = { route: 'commandcode', modelId: 'claude-opus-5-5', company: 'Anthropic', service: 'CommandCode', wire: 'messages', effort: 'medium' }
  assert.equal(resolveModelKey(settings, selection), 'commandcode/claude-opus-5-5')
  assert.equal(resolveModelKey(settings, 'anthropic/claude-opus-5-5'), 'anthropic/claude-opus-5-5')
})

test('a remapped wire model still resolves from its offered model id', () => {
  const settings = {
    models: {
      'openai/gpt-5': { modelId: 'gpt-5', wireModel: 'gpt-5-codex', route: 'openai-codex', service: 'ChatGPT plan', company: 'OpenAI', wire: 'responses' },
    },
  }
  const selection = { route: 'openai-codex', modelId: 'gpt-5', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses', effort: 'medium' }
  assert.equal(resolveModelKey(settings, selection), 'openai/gpt-5')
})

test('the reviewer picked on Start is resolved for the session', () => {
  const reviewer = 'openai/gpt-6-sol'
  const withReviewer = { ...snapshot, roles: { ...snapshot.roles, reviewer: { route: 'openai-codex', modelId: 'gpt-6-sol', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses', effort: 'high' } } }
  const settings = { models: { ...models, [reviewer]: { wireModel: 'gpt-6-sol', route: 'openai-codex', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses' } } }
  assert.equal(createPstackSession(settings, withReviewer, table).reviewerModel, reviewer)
  assert.equal(createPstackSession({ models }, snapshot, table).reviewerModel, null)
})

test('a raw model ID is not rejected for provider metadata', () => {
  const settings = { models: { ...models, [sol]: { wireModel: 'gpt-6-sol', route: 'openai-codex', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses' } } };
  const input = { ...snapshot, roles: { ...snapshot.roles, orchestrator: { modelId: 'gpt-6-sol', route: 'commandcode', company: 'OpenAI', service: 'CommandCode', wire: 'chat' } } };
  assert.equal(createPstackSession(settings, input, table).orchestratorModel, sol)
})

test('machinery selects Beam for every role and every helper', () => {
  const machinerySnapshot = { ...snapshot, roles: { orchestrator: beam, coder: beam } }
  const session = createPstackSession({ models, machineryProof: true, machineryModel: beam }, machinerySnapshot, table)
  assert.equal(session.orchestratorModel, beam)
  assert.equal(session.coderModel, beam)
  assert.deepEqual(session.helpers.map(helper => helper.defaultModelId), [beam])
  assert.ok(session.helpers.every(helper => helper.maxSteps === 100))
  for (const line of session.pstackModels.split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#'))) {
    assert.equal(line.slice(line.indexOf(':') + 1).trim(), beam)
  }
  assert.throws(() => createPstackSession({ models, machineryProof: true }, machinerySnapshot, table), /machinery model/)
  assert.throws(() => createPstackSession({ models }, machinerySnapshot, 'feature: DeepSeek'), /unknown pstack model/)
})

test('inspection reports missing checklist and no real change without failing the run', () => {
  const events = [{ type: 'message_end' }]
  const evidence = inspectPstackRun({ events, requests: [], checklist: '', decisions: '', changedFiles: [] })
  assert.deepEqual(evidence.unproven, ['missing checklist', 'no real change'])
  assert.equal(evidence.next, 'Remediation')
  assert.equal(evidence.checklist, null)
  assert.equal(evidence.decisions, null)
  assert.deepEqual(evidence.events, events)
})

test('inspection records a checklist and changed files as proven inputs to the evidence review', () => {
  const evidence = inspectPstackRun({
    events: [],
    requests: [{ model: deepseek }],
    checklist: '- [x] Build\n',
    decisions: 'ts\tphase\tdecision\n',
    changedFiles: ['marker.txt'],
  })
  assert.deepEqual(evidence.unproven, [])
  assert.equal(evidence.next, 'Evidence review')
  assert.equal(evidence.checklist, '- [x] Build\n')
  assert.equal(evidence.decisions, 'ts\tphase\tdecision\n')
  assert.deepEqual(evidence.changedFiles, ['marker.txt'])
})

test('a checklist that skips steps or mentions publishing is not rejected by the host', () => {
  const evidence = inspectPstackRun({
    events: [],
    requests: [],
    checklist: '- [x] Delegate code-writing. skip: done directly\n- [x] Opening a PR\n',
    decisions: 'x',
    changedFiles: ['a.mjs'],
  })
  assert.deepEqual(evidence.unproven, [])
})
