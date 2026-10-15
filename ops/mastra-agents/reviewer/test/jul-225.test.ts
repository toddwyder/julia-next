import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  CardAdmissionSchema,
  ConnectionRecordSchema,
  ModelOfferSchema,
  RoleDefaultsSchema,
  SecretReferenceSchema,
} from '../src/mastra/contracts.ts'
import { ConnectionStore } from '../src/mastra/connections.ts'
import { validateRoleDefaults } from '../src/mastra/roles.ts'
import { decideStart, ensureSelectionsOffered } from '../src/mastra/init.ts'
import { discoverCommandCodeOffers } from '../src/mastra/routes.ts'

test('secret and persisted connection contracts reject secret values', () => {
  assert.equal(SecretReferenceSchema.parse('COMMANDCODE_API_KEY'), 'COMMANDCODE_API_KEY')
  assert.throws(() => SecretReferenceSchema.parse('sk-this-is-a-secret-value'))
  assert.throws(() => ConnectionRecordSchema.parse({
    id: 'commandcode', route: 'commandcode', company: 'DeepSeek', service: 'CommandCode',
    enabled: true, secretReference: 'Bearer actual-secret',
  }))
})

test('real file-backed connection lifecycle persists only parsed records and redacted output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul-225-connections-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'connections.json')
  const store = new ConnectionStore(path)
  await store.add({ id: 'commandcode', route: 'commandcode', company: 'DeepSeek', service: 'CommandCode', enabled: true, secretReference: 'COMMANDCODE_API_KEY' })
  await store.reconnect('commandcode', { secretReference: 'COMMANDCODE_API_KEY' })
  await store.recordTest('commandcode', { ok: true, modelCount: 2 })
  await store.disable('commandcode')
  assert.equal((await store.list())[0]?.enabled, false)
  await store.remove('commandcode')
  assert.deepEqual(await store.list(), [])
  assert.doesNotMatch(await readFile(path, 'utf8'), /actual-secret|Bearer\s/i)
})

test('model offers keep duplicate IDs distinct by route', () => {
  const antigravity = ModelOfferSchema.parse({ route: 'antigravity', modelId: 'shared', name: 'Shared', company: 'Google', service: 'Antigravity', codingCapable: true })
  const claude = ModelOfferSchema.parse({ route: 'claude', modelId: 'shared', name: 'Shared', company: 'Anthropic', service: 'Claude', codingCapable: true })
  assert.notEqual(`${antigravity.route}:${antigravity.modelId}`, `${claude.route}:${claude.modelId}`)
})

test('CommandCode discovery keeps coding endpoints and rejects decision-only models', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [
    { id: 'claude-a', supported_endpoints: ['/v1/messages'] },
    { id: 'gpt-a', supported_endpoints: ['/v1/responses'] },
    { id: 'legacy-a', supported_endpoints: ['/v1/chat/completions'] },
    { id: 'systemone', supported_endpoints: ['/systemone'] },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  const offers = await discoverCommandCodeOffers('reference-only', fetchImpl as typeof fetch)
  assert.deepEqual(offers.map(({ modelId, wire }) => [modelId, wire]), [
    ['claude-a', 'messages'], ['gpt-a', 'responses'], ['legacy-a', 'chat'],
  ])
})

test('four-role company and normal service rules are exhaustive', () => {
  const selection = (company: string, service: string, route: 'antigravity' | 'claude' | 'commandcode') => ({ route, modelId: 'm', company, service })
  const valid = RoleDefaultsSchema.parse({
    builder: selection('Google', 'Antigravity', 'antigravity'), reviewer: selection('DeepSeek', 'CommandCode', 'commandcode'),
    crashFixer: selection('Anthropic', 'Claude', 'claude'), fixReviewer: selection('Google', 'Antigravity', 'antigravity'),
  })
  assert.doesNotThrow(() => validateRoleDefaults(valid))
  assert.throws(() => validateRoleDefaults({ ...valid, reviewer: selection('Google', 'CommandCode', 'commandcode') }), /different companies/)
  assert.throws(() => validateRoleDefaults({ ...valid, reviewer: selection('DeepSeek', 'Antigravity', 'antigravity') }), /different services/)
  assert.doesNotThrow(() => validateRoleDefaults({ ...valid, reviewer: selection('DeepSeek', 'Antigravity', 'antigravity') }, { allowSameService: true }))
  assert.throws(() => validateRoleDefaults({ ...valid, fixReviewer: selection('Anthropic', 'Antigravity', 'antigravity') }), /crash-fixer and fix reviewer/)
})

test('admission requires the complete settled card shape and Ready state', () => {
  const complete = { identifier: 'JUL-225', state: 'Ready', description: '# Outcome\nA\n# Requirements\nB\n# Contracts\nC\n# Finish conditions\nD\n# Proof\nE' }
  assert.equal(CardAdmissionSchema.parse(complete).identifier, 'JUL-225')
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, state: 'Backlog' }))
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, description: '# Outcome\nA' }))
  assert.throws(() => CardAdmissionSchema.parse({ ...complete, description: `${complete.description}\nTODO: decision` }))
})

test('Cancel never dispatches and restart reuses the immutable snapshot', async () => {
  let dispatches = 0
  const snapshot = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'DeepSeek', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'c', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  assert.deepEqual(await decideStart({ decision: 'Cancel', snapshot, dispatch: async () => { dispatches += 1 } }), { status: 'cancelled' })
  assert.equal(dispatches, 0)
  const started = await decideStart({ decision: 'Start', snapshot, dispatch: async saved => { dispatches += 1; return saved } })
  snapshot.builder.modelId = 'changed-after-save'
  assert.equal(started.status, 'started')
  assert.equal(started.snapshot.builder.modelId, 'a')
  assert.equal(dispatches, 1)
})

test('admission refuses stale defaults that are not in the current route offers', () => {
  const roles = RoleDefaultsSchema.parse({
    builder: { route: 'antigravity', modelId: 'a', company: 'Google', service: 'Antigravity' },
    reviewer: { route: 'commandcode', modelId: 'b', company: 'DeepSeek', service: 'CommandCode' },
    crashFixer: { route: 'claude', modelId: 'c', company: 'Anthropic', service: 'Claude' },
    fixReviewer: { route: 'antigravity', modelId: 'd', company: 'Google', service: 'Antigravity' },
  })
  const offers = [
    { route: 'antigravity', modelId: 'a' }, { route: 'commandcode', modelId: 'b' },
    { route: 'claude', modelId: 'c' }, { route: 'antigravity', modelId: 'd' },
  ]
  assert.doesNotThrow(() => ensureSelectionsOffered(roles, offers))
  assert.throws(() => ensureSelectionsOffered(roles, offers.slice(0, 3)), /fixReviewer.*unavailable/)
})
