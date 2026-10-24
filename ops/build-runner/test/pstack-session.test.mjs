import test from 'node:test'
import assert from 'node:assert/strict'
import { createPstackSession, inspectPstackRun } from '../pstack-session.mjs'

const beam = 'commandcode/reflection/beam:free'
const deepseek = 'commandcode/deepseek/deepseek-v4.1-flash'
const sol = 'openai/gpt-6-sol'
const models = Object.fromEntries([beam, deepseek, sol].map(id => [id, { wireModel: id }]))
const snapshot = { card: { identifier: 'JUL-253', title: 'Model split', description: 'Ship the agreed model split.' }, roles: { orchestrator: sol, coder: deepseek } }
const table = `feature, refactoring: ${deepseek}\nmain session: ${sol}\nhardest tasks: ${sol}\ninterrogate reviewers: ${sol}, ${deepseek}\n`

test('an unrelated review model cannot replace the configured Sol and DeepSeek panel', () => {
  const events = [
    { type: 'subagent_start', toolCallId: 'build', modelId: deepseek, task: 'Implement marker.txt' },
    { type: 'subagent_tool_end', toolCallId: 'build', subToolName: 'write_file', isError: false },
    { type: 'subagent_end', toolCallId: 'build', result: 'Built marker', isError: false },
    { type: 'subagent_start', toolCallId: 'review', modelId: 'anthropic/claude-haiku-5-5', task: 'Review marker.txt' },
    { type: 'subagent_end', toolCallId: 'review', result: 'Reviewed', isError: false },
  ];
  assert.throws(() => inspectPstackRun({ events, requests: [], coderModel: deepseek,
    reviewModels: [sol, deepseek], machineryProof: false, changedFiles: ['marker.txt'],
    checklist: '- [x] Build', decisions: 'Reviewed',
  }), /review handoff/);
});

test('normal session keeps the configured Sol/DeepSeek split and every exact model', () => {
  const session = createPstackSession({ models }, snapshot, table)
  assert.equal(session.orchestratorModel, sol)
  assert.equal(session.coderModel, deepseek)
  assert.equal(session.machineryProof, false)
  assert.equal(session.reviewModel, undefined)
  assert.deepEqual(session.helpers.map(h => h.defaultModelId), [beam, deepseek, sol])
  assert.equal(new Set(session.helpers.map(h => h.id)).size, 3)
  assert.equal(session.helpers.some(h => ['coder', 'reviewer', 'cap-check'].includes(h.id)), false)
  assert.match(session.prompt, /follow.*poteto-mode/i)
  assert.match(session.prompt, /Ship the agreed model split\./)
  assert.doesNotMatch(session.prompt, /delegate|cap-check|REVIEW_AND_PROOF/)
  assert.equal(session.pstackModels, table)
  assert.match(session.hostInstructions, /successful review by a different model of the actual changed files/i)
  assert.doesNotMatch(session.hostInstructions, /paid review|Trial forbids|connection core/i)
})

test('the internal builder boundary is structural rather than a prose prohibition', () => {
  const card = {
    identifier: 'JUL-255',
    description: '**Desired behavior:** Create JUL-253-START-PRACTICE-2.txt containing exactly Julia cleaned Start proof. followed by one newline.\n\n**Acceptance criteria:** Use the real Tailscale Start page, drive its browser, restart the server, and retain the ledger and candidate evidence.',
  }
  const session = createPstackSession({ models }, { ...snapshot, card }, table)
  assert.doesNotMatch(session.prompt, /Implement only the saved card's repository Desired behavior|subject to the internal Build boundary/i)
  assert.doesNotMatch(session.hostInstructions, /host owns the outer Start route|do not drive or re-investigate|reread prior proof trees/i)
  assert.match(session.hostInstructions, /Both configured panel models.*must complete their reviews/)
  assert.match(session.hostInstructions, /\.builder-home\/pstack\/checklist\.md/)
  assert.match(session.hostInstructions, /\.builder-home\/pstack\/decisions\.tsv/)
})

test('machinery selects Beam for every role and describes a self-check, not independent review', () => {
  const machinerySnapshot = { ...snapshot, roles: { orchestrator: beam, coder: beam } }
  const session = createPstackSession({ models, machineryProof: true, machineryModel: beam }, machinerySnapshot, table)
  assert.equal(session.orchestratorModel, beam)
  assert.equal(session.coderModel, beam)
  assert.equal(session.reviewModel, beam)
  assert.deepEqual(session.helpers.map(h => h.defaultModelId), [beam])
  for (const line of session.pstackModels.split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#'))) {
    assert.equal(line.slice(line.indexOf(':') + 1).trim(), beam)
  }
  assert.match(session.hostInstructions, /machinery self-check/i)
  assert.match(session.hostInstructions, /not independent review/i)
  assert.doesNotMatch(session.hostInstructions, /paid review|Trial forbids|connection core/i)
  assert.throws(() => createPstackSession({ models, machineryProof: true }, machinerySnapshot, table), /machinery model/)
  assert.throws(() => createPstackSession({ models }, machinerySnapshot, 'feature: DeepSeek'), /unknown pstack model/)
})

test('normal proof requires successful distinct-model review of actual changed files', () => {
  const build = [
    { type: 'subagent_start', toolCallId: 'build', modelId: deepseek, task: 'Implement marker.txt' },
    { type: 'subagent_tool_end', toolCallId: 'build', subToolName: 'mastra_workspace_write_file', subToolResult: 'Wrote 36 bytes to marker.txt', isError: false },
    { type: 'subagent_end', toolCallId: 'build', result: 'Built marker', isError: false },
  ]
  const review = [
    { type: 'subagent_start', toolCallId: 'review', modelId: sol, task: 'Review marker.txt against the saved requirements' },
    { type: 'subagent_end', toolCallId: 'review', result: 'Review passed', isError: false },
    { type: 'subagent_start', toolCallId: 'review-deepseek', modelId: deepseek, task: 'Review marker.txt against the saved requirements' },
    { type: 'subagent_end', toolCallId: 'review-deepseek', result: 'Review passed', isError: false },
  ]
  const input = {
    events: [...build, ...review],
    requests: [{ model: 'deepseek/deepseek-v4.1-flash', status: 200 }, { model: 'gpt-6-sol', status: 200 }],
    coderModel: deepseek, reviewModel: undefined, reviewModels: [sol, deepseek], machineryProof: false,
    cardId: 'JUL-253', changedFiles: ['marker.txt'],
    checklist: '- [x] Build\n- [x] Proof\n',
    decisions: 'ts\tphase\tdecision\n2026-10-23\tbuild\tUse marker\n',
  }
  const evidence = inspectPstackRun(input)
  assert.equal(evidence.hasCoder, true)
  assert.equal(evidence.hasReviewer, true)
  assert.equal(evidence.reviewHandoff.modelId, sol)
  assert.equal(evidence.reviewHandoff.refused, false)
  assert.deepEqual(evidence.reviewHandoffs.map(review => review.modelId), [sol, deepseek])
  assert.equal(evidence.deepseekRefusal, false)
  assert.equal(evidence.deepseekSent, true)
  assert.deepEqual(evidence.events, input.events)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [x] Build\n- [x] 8. Opening a PR: open PR to main.' }), /publishing is outside/)
  assert.throws(() => inspectPstackRun({ ...input, events: input.events.filter(e => e.type !== 'subagent_tool_end') }), /coder tool activity/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...review[0], task: 'Review JUL-253 requirements' }, review[1]] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, review[0], { ...review[1], isError: true, result: 'Review refused' }] }), /pstack review failed/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...review[0], modelId: deepseek }, review[1]] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...review, ...build] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...review[0], task: 'Run a trivial cap check' }, review[1]] }), /review handoff/)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [x] Delegate code-writing. skip: done directly' }), /checklist contradicts/)
  assert.throws(() => inspectPstackRun({ ...input, checklist: '- [ ] Build\n- [ ] Review\n- [ ] Proof' }), /completed checklist item/)
})

test('machinery proof completes a successful Beam self-check without DeepSeek dispatch', () => {
  const build = [
    { type: 'subagent_start', toolCallId: 'build', modelId: beam, task: 'Implement marker.txt' },
    { type: 'subagent_tool_end', toolCallId: 'build', subToolName: 'mastra_workspace_write_file', subToolResult: 'Wrote 36 bytes to marker.txt', isError: false },
    { type: 'subagent_end', toolCallId: 'build', result: 'Built marker', isError: false },
  ]
  const selfCheck = [
    { type: 'subagent_start', toolCallId: 'check', modelId: beam, task: 'Self-check marker.txt against the saved requirements' },
    { type: 'subagent_end', toolCallId: 'check', result: 'Self-check passed', isError: false },
  ]
  const input = {
    events: [...build, ...selfCheck],
    requests: [{ model: 'reflection/beam:free', status: 200 }],
    coderModel: beam, reviewModel: beam, machineryProof: true,
    cardId: 'JUL-253', changedFiles: ['marker.txt'],
    checklist: '- [x] Build\n- [x] Proof\n',
    decisions: 'ts\tphase\tdecision\n2026-10-23\tbuild\tUse marker\n',
  }
  const evidence = inspectPstackRun(input)
  assert.equal(evidence.hasCoder, true)
  assert.equal(evidence.reviewHandoff.modelId, beam)
  assert.equal(evidence.reviewHandoff.refused, false)
  assert.equal(evidence.deepseekRefusal, false)
  assert.equal(evidence.deepseekSent, false)
  assert.equal(inspectPstackRun({ ...input, requests: [{ model: 'deepseek/deepseek-v4.1-flash', status: 200 }] }).deepseekSent, true)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, { ...selfCheck[0], task: 'Self-check JUL-253 requirements' }, selfCheck[1]] }), /machinery self-check/)
  assert.throws(() => inspectPstackRun({ ...input, events: [...build, selfCheck[0], { ...selfCheck[1], isError: true, result: 'Self-check refused' }] }), /machinery self-check failed/)
})

test('a raw model ID cannot silently change the selected provider route', () => {
  const settings = { models: { ...models, [sol]: { wireModel: 'gpt-6-sol', route: 'openai-codex', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses' } } };
  const input = { ...snapshot, roles: { ...snapshot.roles, orchestrator: { modelId: 'gpt-6-sol', route: 'commandcode', company: 'OpenAI', service: 'CommandCode', wire: 'chat' } } };
  assert.throws(() => createPstackSession(settings, input, table), /provider mismatch/);
  input.roles.orchestrator = { modelId: 'gpt-6-sol', route: 'openai-codex', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses' };
  assert.equal(createPstackSession(settings, input, table).orchestratorModel, sol);
});
