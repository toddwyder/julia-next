import test from 'node:test'
import assert from 'node:assert/strict'
import { pauseReason } from '../worker-policy.mjs'

test('hitting the turn limit pauses the build as a runaway', () => {
  assert.equal(pauseReason('max_turns', ''), 'runaway: reached the 100-turn limit')
})

test('a provider that stays down pauses the build with its reason', () => {
  assert.equal(pauseReason('error', 'provider down: Provider request failed (HTTP 503)'), 'provider down: Provider request failed (HTTP 503)')
  assert.equal(pauseReason('error', 'Provider request failed (HTTP 503)'), 'provider down: Provider request failed (HTTP 503)')
})

test('an ordinary error or completion does not pause the build', () => {
  assert.equal(pauseReason('error', 'candidate not clean'), null)
  assert.equal(pauseReason('completed', ''), null)
  assert.equal(pauseReason('aborted', ''), null)
})
