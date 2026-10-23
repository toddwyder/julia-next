import assert from 'node:assert/strict'
import { CardLedger } from '../ledger.mjs'

const [path, card, requests, spentNano] = process.argv.slice(2)
const ledger = new CardLedger({ path, card })
try {
  const snapshot = ledger.snapshot()
  assert.equal(snapshot.spentNano, Number(spentNano))
  assert.equal(snapshot.requests.length, Number(requests))
  console.log(JSON.stringify({ freshProcess: true, ...snapshot }))
} finally { ledger.close() }
