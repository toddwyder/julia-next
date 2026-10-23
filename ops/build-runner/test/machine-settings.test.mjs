import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('machine-settings contains beam proof config and deepseek paid refusal', async () => {
  const settings = JSON.parse(await readFile(join(process.cwd(), 'ops/build-runner/machine-settings.json'), 'utf8'))
  assert.deepEqual(Object.keys(settings.roles).sort(), ['coder', 'orchestrator'])
  assert.equal(settings.roles.orchestrator, 'commandcode-free/reflection/beam:free')
  assert.equal(settings.roles.coder, 'commandcode-free/reflection/beam:free')
  assert.equal(settings.memory, false)
  assert.equal(settings.machineryProof, true)
  const paid = Object.entries(settings.models).filter(([, s]) => Object.values(s.price).some(v => v > 0))
  assert.equal(paid.length, 1)
  assert.match(paid[0][0], /deepseek/i)
})
