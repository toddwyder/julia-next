import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { RequestContext } from '@mastra/core/request-context'
import { TokenCounter } from '@mastra/memory/processors'
import { openRunner } from '../adapter.mjs'

const [root, settingsPath] = process.argv.slice(2)
await mkdir(`${root}/workspace`, { recursive: true })
const runner = await openRunner({ card: 'JUL-251', cwd: `${root}/workspace`, stateDir: `${root}/state`, settingsPath })
try {
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  const session = runner.runtime.session
  const thread = await session.thread.create({ title: 'Stock memory proof' })
  await session.model.switch(settings.roles.builder)
  const memory = await runner.memory()
  const engine = await memory.omEngine
  if (settings.memory === false) {
    assert.equal(engine, null)
    assert.equal(runner.snapshot().requests.length, 0)
    console.log(JSON.stringify({ memory: 'off', observation: false, reflection: false, requests: 0 }))
  } else {
    assert.ok(engine)
    const resourceId = session.identity.getResourceId()
    const requestContext = new RequestContext()
    requestContext.set('controller', { threadId: thread.id, resourceId, session: { modelId: session.model.get() }, getState: () => session.state.get() })
    const fact = `The household proof word is Saffron-${randomUUID().slice(0, 8)}. Preserve this exact word for later recall.`
    const messageId = randomUUID()
    await memory.saveMessages({ messages: [{ id: messageId, threadId: thread.id, resourceId, role: 'user', createdAt: new Date(), type: 'text', content: { format: 2, parts: [{ type: 'text', text: fact }] } }] })
    const observed = await engine.observe({ threadId: thread.id, resourceId, force: true, requestContext, agent: runner.runtime.codeAgent })
    assert.equal(observed.observed, true)
    assert.match(observed.record.activeObservations, /Saffron-/)
    const counter = new TokenCounter()
    let thresholdFixture = observed.record.activeObservations
    while (counter.countObservations(thresholdFixture) < 45_000) thresholdFixture += '\n' + observed.record.activeObservations
    const store = await runner.runtime.storage.getStore('memory')
    await store.updateActiveObservations({ id: observed.record.id, observations: thresholdFixture, tokenCount: counter.countObservations(thresholdFixture), lastObservedAt: new Date(), observedMessageIds: [messageId] })
    assert.equal(engine.config.observation.messageTokens, 30_000)
    assert.equal(engine.config.reflection.observationTokens, 40_000)
    await memory.deleteMessages([messageId])
    const history = await memory.recall({ threadId: thread.id, resourceId, perPage: false })
    assert.equal(JSON.stringify(history.messages).includes('Saffron-'), false)
    const beforeRecall = runner.snapshot().requests.length
    const recalled = await runner.run({ threadId: thread.id, prompt: 'What is the exact household proof word I asked you to preserve? Reply with the word only. Do not use tools.' })
    assert.equal(recalled.result.status, 'completed')
    await runner.runtime.memory.settled()
    const reflected = await engine.getRecord(thread.id, resourceId)
    assert.ok(reflected.generationCount > observed.record.generationCount, 'normal Auto turn must commit a reflection generation')
    assert.match(reflected.activeObservations, /Saffron-/)
    const word = fact.match(/Saffron-[a-f0-9]+/)[0]
    assert.ok(recalled.result.text.includes(word), 'recall must recover a fact absent from raw history')
    const account = runner.snapshot()
    assert.equal(account.spentNano, 0)
    assert.ok(account.requests.length > beforeRecall)
    console.log(JSON.stringify({ memory: 'Auto', observation: observed.observed, reflection: true, observationText: observed.record.activeObservations, reflectionText: reflected.activeObservations, reflectionFixture: 'Repeated the real observation to cross the unchanged stock 40000-token threshold.', fixtureTokens: counter.countObservations(thresholdFixture), config: engine.config, rawHistoryContainsFact: false, recall: recalled.result.text, word, account }))
  }
} finally { await runner.close() }
