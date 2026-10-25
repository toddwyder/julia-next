import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RequestContext } from '@mastra/core/request-context'
import { openRunner } from '../../adapter.mjs'

const card = 'JUL-331'

test('one real Beam build turn settles its main and memory requests on one card account', {
  timeout: 180_000,
}, async t => {
  assert.ok(process.env.COMMANDCODE_API_KEY, 'COMMANDCODE_API_KEY must be supplied through the approved vault')
  const root = await mkdtemp(join(tmpdir(), 'jul331-memory-account-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const stateDir = join(root, 'state')
  const ledgerPath = join(root, 'cards.sqlite')
  await mkdir(workspace)
  const embeddingCache = join(stateDir, '.cache', 'mastra', 'fastembed-models')
  await mkdir(dirname(embeddingCache), { recursive: true })
  await cp(join(homedir(), '.cache', 'mastra', 'fastembed-models'), embeddingCache, { recursive: true })

  const settings = JSON.parse(await readFile(new URL('../../settings.json', import.meta.url), 'utf8'))
  settings.ledgerPath = ledgerPath
  settings.authPath = join(root, 'auth.json')
  settings.memory = true
  const settingsPath = join(root, 'settings.json')
  await writeFile(settingsPath, JSON.stringify(settings))

  const runner = await openRunner({ card, settingsPath, cwd: workspace, stateDir, role: 'builder' })
  try {
    const session = runner.runtime.session
    const thread = await session.thread.create({ title: 'JUL-331 memory account' })
    await session.model.switch(settings.roles.builder)
    const memory = await runner.memory()
    const engine = await memory.omEngine
    assert.ok(engine, 'observational memory must be on')
    const resourceId = session.identity.getResourceId()
    const requestContext = new RequestContext()
    requestContext.set('controller', { threadId: thread.id, resourceId, session: { modelId: session.model.get() }, getState: () => session.state.get() })
    await memory.saveMessages({
      messages: [{
        id: randomUUID(), threadId: thread.id, resourceId, role: 'user', createdAt: new Date(), type: 'text',
        content: { format: 2, parts: [{ type: 'text', text: `The build proof word is Saffron-${randomUUID().slice(0, 8)}.` }] },
      }],
    })
    const observed = await engine.observe({ threadId: thread.id, resourceId, force: true, requestContext, agent: runner.runtime.codeAgent })
    assert.equal(observed.observed, true, 'the real observation must reach the Beam model')
    const memoryIds = new Set(runner.snapshot().requests.map(request => request.id))

    const receipt = await runner.run({ threadId: thread.id, prompt: 'Reply with BUILD_OK only. Do not use tools.' })
    assert.equal(receipt.result.status, 'completed')
    await runner.runtime.memory.settled()

    const account = runner.snapshot()
    assert.equal(account.heldNano, 0, 'no card reservation may remain held')
    assert.ok(account.requests.every(request => request.state === 'settled'), 'every request must settle')
    const mainRequests = account.requests.filter(request => !memoryIds.has(request.id))
    assert.ok(mainRequests.length > 0, 'the build turn must settle a main request')

    const database = new DatabaseSync(ledgerPath)
    try {
      const cards = database.prepare('SELECT DISTINCT card FROM requests ORDER BY card').all().map(row => row.card)
      const unsettled = database.prepare("SELECT COUNT(*) AS count FROM requests WHERE state != 'settled'").get().count
      assert.deepEqual(cards, [card], 'the main and memory requests must settle against the same card account')
      assert.equal(unsettled, 0, 'every recorded request must be settled')
      assert.ok(memoryIds.size > 0, 'the memory request must settle on the card account')
    } finally {
      database.close()
    }
  } finally {
    await runner.close()
  }
})
