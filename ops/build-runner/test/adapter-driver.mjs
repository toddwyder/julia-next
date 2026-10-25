import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { openRunner } from '../adapter.mjs'

const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
const runner = await openRunner(input)
try {
  const direct = await runner.execute(`node -e 'if(Object.keys(process.env).some(k=>/KEY|TOKEN|SECRET|AUTH/.test(k)))process.exit(2);try{require("fs").readFileSync(${JSON.stringify(input.secretFile)});process.exit(3)}catch(e){if(e.code!=="EACCES")throw e}console.log("direct-isolated")'`)
  assert.match(String(direct), /direct-isolated/)
  const nested = await runner.execute(`bash -c 'node -e '\''if(Object.keys(process.env).some(k=>/KEY|TOKEN|SECRET|AUTH/.test(k)))process.exit(2);for(const p of ${JSON.stringify([input.secretFile, '/proc/self/environ', '/home/ubuntu/.codex/auth.json'])}){try{require("fs").readFileSync(p);process.exit(3)}catch(e){if(!["EACCES","ENOENT"].includes(e.code))throw e}}console.log("nested-isolated")'\'''`)
  assert.match(String(nested), /nested-isolated/)
  const reply = await runner.run({ prompt: 'Reply with JUL251_OK only. Do not use tools.', maxTurns: 100, inactivityMs: 600000 })
  assert.equal(reply.result.status, 'completed', reply.result.error?.message)
  assert.match(reply.result.text, /JUL251_OK/)
  assert.equal(reply.account.spentNano, 0)
  assert.ok(reply.account.requests.length >= (input.minimumAttempts ?? 1))
  const settingsFiles = await readFile(`${input.stateDir}/sdk/settings.json`, 'utf8')
  assert.equal(settingsFiles.includes('synthetic-secret-marker'), false)
  console.log(JSON.stringify({ direct: 'isolated', nested: 'isolated', provider: 'JUL251_OK', spentNano: reply.account.spentNano, attempts: reply.account.requests.length }))
} finally { await runner.close() }
