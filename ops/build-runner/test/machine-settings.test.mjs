import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createPstackSession } from '../pstack-session.mjs'

const settings = JSON.parse(await readFile(new URL('../machine-settings.json', import.meta.url), 'utf8'))
const table = await readFile(new URL('../pstack-models.md', import.meta.url), 'utf8')

test('normal machine sessions use Claude and DeepSeek and preserve the two-model panels', () => {
  const session = createPstackSession(settings, { roles: settings.roles, card: { identifier: 'JUL-253' } }, table)
  assert.equal(session.orchestratorModel, 'anthropic/claude-haiku-5-5')
  assert.equal(session.coderModel, 'commandcode/deepseek/deepseek-v4.1-flash')
  assert.equal(session.machineryProof, false)
  const entries = Object.fromEntries(session.pstackModels.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const split = line.indexOf(':')
    return [line.slice(0, split), line.slice(split + 1).trim().split(', ')]
  }))
  assert.deepEqual(entries['main session'], ['anthropic/claude-haiku-5-5'])
  assert.deepEqual(entries['hardest tasks'], ['anthropic/claude-haiku-5-5'])
  assert.deepEqual(entries['swarm workers'], ['commandcode/deepseek/deepseek-v4.1-flash'])
  for (const role of ['how explorer', 'how explainer', 'why investigators']) {
    assert.deepEqual(entries[role], ['commandcode/deepseek/deepseek-v4.1-flash'])
  }
  assert.deepEqual(entries['why synthesizer'], ['anthropic/claude-haiku-5-5'])
  for (const role of ['arena runners', 'architect runners', 'interrogate reviewers']) {
    assert.deepEqual(entries[role], ['anthropic/claude-haiku-5-5', 'commandcode/deepseek/deepseek-v4.1-flash'])
  }
  for (const model of Object.values(settings.models)) {
    assert.ok(model.source.startsWith('https://'))
    assert.ok(model.boundsSource.startsWith('https://'))
    assert.ok(model.maxInputTokens > 0 && model.maxOutputTokens > 0)
    for (const category of ['input', 'output', 'cacheRead', 'cacheWrite']) assert.ok(Number.isFinite(model.price[category]))
  }
  assert.equal(settings.models['openai/gpt-6-sol'].price.input, 2)
  assert.equal(settings.models['openai/gpt-6-sol'].price.output, 10)
  assert.ok(settings.authPath)
  assert.ok(settings.ledgerPath)
})

test('an explicit machinery drive uses Beam for the session and every helper', () => {
  const session = createPstackSession(settings, { roles: settings.roles, machineryProof: true }, table)
  assert.equal(session.orchestratorModel, 'commandcode/reflection/beam:free')
  assert.equal(session.coderModel, 'commandcode/reflection/beam:free')
  assert.deepEqual(session.helpers.map(helper => helper.defaultModelId), ['commandcode/reflection/beam:free'])
})
