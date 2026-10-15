import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { doctor } from '../src/mastra/verify-machine.ts'

test('Doctor reads the permanent-parts inventory and fails closed on a missing controlled part', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-machine-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const existing = join(directory, 'present.exe')
  await writeFile(existing, '')
  const inventory = join(directory, 'permanent-parts.json')
  await writeFile(inventory, JSON.stringify({ version: 1, parts: [
    { id: 'present', name: 'Present', kind: 'executable', location: existing, permanent: true },
    { id: 'missing', name: 'Missing', kind: 'sign-in', location: join(directory, 'missing.json'), permanent: true },
  ] }))
  const frameworkMap = join(directory, 'framework-map.md')
  await writeFile(frameworkMap, `Doctor inventory: \`${inventory}\`.\n`)
  const result = await doctor(frameworkMap)
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing.map(item => item.id), ['missing'])
})
