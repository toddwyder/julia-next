import test from 'node:test'
import assert from 'node:assert/strict'
import { createPstackSession, inspectPstackRun } from '../pstack-session.mjs'

const beam = 'commandcode-free/reflection/beam:free'
const deepseek = 'commandcode-free/deepseek/deepseek-v4.1-flash'
const sol = 'openai/gpt-6-sol'
const models = Object.fromEntries([beam, deepseek, sol].map(id => [id, { wireModel: id }]))
const snapshot = { card: { identifier: 'JUL-232', title: 'Marker', description: 'Write the marker.' }, roles: { orchestrator: beam, coder: beam } }
const table = `feature, refactoring: ${deepseek}\nmain session: ${sol}\ninterrogate reviewers: ${sol}, ${deepseek}\n`

test('session exposes every exact model through a neutral helper and hands the saved card to pstack', () => {
  const session = createPstackSession({ models }, snapshot, table)
  assert.deepEqual(session.helpers.map(h => h.defaultModelId), [beam, deepseek, sol])
  assert.equal(new Set(session.helpers.map(h => h.id)).size, 3)
  assert.equal(session.helpers.some(h => ['coder', 'reviewer', 'cap-check'].includes(h.id)), false)
  assert.match(session.prompt, /follow.*poteto-mode/i)
  assert.match(session.prompt, /Write the marker\./)
  assert.doesNotMatch(session.prompt, /delegate|cap-check|REVIEW_AND_PROOF/)
  assert.equal(session.pstackModels, table)
})

test('machinery uses Beam for work while keeping the configured diverse review model reachable', () => {
  const session = createPstackSession({ models, machineryProof: true, machineryReviewModel: deepseek }, snapshot, table)
  assert.match(session.pstackModels, new RegExp(`feature, refactoring: ${beam.replaceAll('/', '\\/')}`))
  assert.ok(session.pstackModels.includes(`interrogate reviewers: ${deepseek}`))
  assert.deepEqual(session.helpers.map(h => h.defaultModelId), [beam, deepseek, sol])
  assert.throws(() => createPstackSession({ models }, snapshot, 'feature: DeepSeek'), /unknown pstack model/)
})

test('proof attributes a refused review to its actual task and distinct model instead of accepting a cap probe', () => {
  const events = [
    { type: 'subagent_start', toolCallId: 'build', modelId: beam, task: 'Implement the marker' },
    { type: 'subagent_end', toolCallId: 'build', result: 'Built marker', isError: false },
    { type: 'subagent_start', toolCallId: 'review', modelId: deepseek, task: 'Review the marker against the saved requirements' },
    { type: 'subagent_end', toolCallId: 'review', result: 'Trial forbids nonzero model prices', isError: true },
  ]
  const requests = [{ model: 'deepseek/deepseek-v4.1-flash', refusal: 'Trial forbids nonzero model prices' }]
  const evidence = inspectPstackRun({ events, requests, coderModel: beam, reviewModel: deepseek, machineryProof: true, checklist: '- [x] Build\n- [x] Proof\n', decisions: 'ts\tphase\tdecision\n2026-10-23\tbuild\tUse marker\n' })
  assert.throws(() => inspectPstackRun({ events, requests, coderModel: beam, reviewModel: deepseek, machineryProof: true, checklist: '- [x] Delegate code-writing. skip: done directly', decisions: 'Decision' }), /checklist contradicts/)
  assert.equal(evidence.reviewHandoff.modelId, deepseek)
  assert.equal(evidence.reviewHandoff.refused, true)
  assert.throws(() => inspectPstackRun({ events: [events[2], events[3], events[0], events[1]], requests, coderModel: beam, reviewModel: deepseek, machineryProof: true, checklist: 'Build', decisions: 'Decision' }), /review handoff/)
  assert.equal(evidence.hasCoder, true)
  assert.deepEqual(evidence.events, events)
  assert.throws(() => inspectPstackRun({ events: events.map(e => e.toolCallId === 'review' ? { ...e, task: 'Run a trivial cap check' } : e), requests, coderModel: beam, reviewModel: deepseek, machineryProof: true, checklist: 'Build', decisions: 'Decision' }), /review handoff/)
})
