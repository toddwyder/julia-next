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

test('proof requires actual coder tool activity and a later review of the changed candidate', () => {
  const build = [
    { type: 'subagent_start', toolCallId: 'build', modelId: beam, task: 'Implement marker.txt' },
    { type: 'subagent_tool_end', toolCallId: 'build', subToolName: 'mastra_workspace_write_file', subToolResult: 'Wrote 36 bytes to marker.txt', isError: false },
    { type: 'subagent_end', toolCallId: 'build', result: 'Built marker', isError: false },
  ]
  const review = [
    { type: 'subagent_start', toolCallId: 'review', modelId: deepseek, task: 'Review marker.txt against the saved requirements' },
    { type: 'subagent_end', toolCallId: 'review', result: 'Trial forbids nonzero model prices', isError: true },
  ]
  const input = {
    events: [...build, ...review],
    requests: [{ model: 'deepseek/deepseek-v4.1-flash', refusal: 'Trial forbids nonzero model prices' }],
    coderModel: beam, reviewModel: deepseek, machineryProof: true,
    cardId: 'JUL-232', changedFiles: ['marker.txt'],
    checklist: '- [x] Build\n- [x] Proof\n',
    decisions: 'ts\tphase\tdecision\n2026-10-23\tbuild\tUse marker\n',
  }
  const evidence = inspectPstackRun(input)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [x] Build\n- [x] 8. Opening a PR: open PR to main.' }), /publishing is outside/)
  assert.equal(evidence.hasCoder, true)
  assert.equal(evidence.reviewHandoff.modelId, deepseek)
  assert.equal(evidence.reviewHandoff.refused, true)
  assert.deepEqual(evidence.events, input.events)
  assert.throws(() => inspectPstackRun({ ...input, events: input.events.filter(e => e.type !== 'subagent_tool_end') }), /coder tool activity/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...review[0], task: 'Review checklist spelling only' }, review[1]] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...review, ...build] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...review[0], task: 'Run a trivial cap check' }, review[1]] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [x] Delegate code-writing. skip: done directly' }), /checklist contradicts/)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [ ] Build\n- [ ] Review\n- [ ] Proof' }), /completed checklist item/)
})
