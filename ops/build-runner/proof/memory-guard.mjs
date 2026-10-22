import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { CardLedger } from '../ledger.mjs'

const [root, settingsPath] = process.argv.slice(2)
const path = 'ops/build-runner/adapter.mjs'
const source = await readFile(path, 'utf8')
const guard = "if (settings.memory === false) process.env.MASTRACODE_DISABLE_OBSERVATIONAL_MEMORY = '1'"
assert.equal(source.split(guard).length - 1, 1)
try {
  await writeFile(path, source.replace(guard, "process.env.MASTRACODE_DISABLE_OBSERVATIONAL_MEMORY = '1'"))
  const result = spawnSync(process.execPath, ['ops/build-runner/proof/memory.mjs', root, settingsPath], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /assert\.ok\(engine\)/)
  const ledger = new CardLedger({ path: `${root}/state/cards.sqlite`, card: 'JUL-251' })
  try {
    const receipt = ledger.snapshot()
    assert.equal(receipt.requests.length, 0)
    assert.equal(receipt.spentNano, 0)
    console.log(JSON.stringify({ mutation: 'stock-memory-disabled', detectedBy: 'memory.mjs requires an active stock OM engine', exitCode: result.status, requests: 0, spentNano: 0 }))
  } finally { ledger.close() }
} finally {
  await writeFile(path, source)
  assert.equal(await readFile(path, 'utf8'), source)
}
