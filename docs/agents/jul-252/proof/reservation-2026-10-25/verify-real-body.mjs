import { copyFileSync, readFileSync } from 'node:fs'
import { CardLedger } from '../../../ops/build-runner/ledger.mjs'
import { createTransport } from '../../../ops/build-runner/transport.mjs'

const [bodyPath, ledgerSource, runSettingsPath] = process.argv.slice(2)
if (!bodyPath || !ledgerSource || !runSettingsPath) throw new Error('usage: verify-real-body.mjs <request.json> <ledger.sqlite> <run-settings.json>')
const body = readFileSync(bodyPath, 'utf8')
const settings = JSON.parse(readFileSync(runSettingsPath, 'utf8'))
settings.models['anthropic/claude-opus-5-5'].inputTokenEstimate = { method: 'o200k_base', multiplier: 2, framingTokens: 4096 }

const db = new URL('./ledger-copy.sqlite', import.meta.url).pathname
copyFileSync(ledgerSource, db)
const ledger = new CardLedger({ path: db, card: 'JUL-252' })
let arrived = 0
const transport = createTransport({
  ledger,
  role: 'orchestrator',
  settings,
  fetch: async () => {
    arrived += 1
    return new Response(JSON.stringify({ usage: { input_tokens: 30000, output_tokens: 2, cache_read_input_tokens: 12000, cache_creation_input_tokens: 1000 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
const before = ledger.snapshot()
const response = await transport(settings.models['anthropic/claude-opus-5-5'].endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
const after = ledger.snapshot()
console.log(JSON.stringify({
  requestBytes: Buffer.byteLength(body),
  dispatched: response.status === 200 && arrived === 1,
  spentBeforeNano: before.spentNano,
  reservationNano: after.requests.at(-1).maximumNano,
  bounds: after.requests.at(-1).bounds,
  remainingNano: after.remainingNano,
}, null, 2))
ledger.close()
