import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkLinearCardAdmission } from '../src/mastra/card-admission-check.ts'
import { completeCardDescription } from '../support/card-admission-test-fixtures/card-admission-descriptions.mjs'

function linearResponse(description) {
  return async () => new Response(JSON.stringify({
    data: {
      issue: {
        identifier: 'JUL-243',
        title: 'A card awaiting settlement',
        description,
        state: { name: 'Triage' },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('checks a Linear card as a Ready candidate without changing its current state', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription))

  assert.deepEqual(result, {
    identifier: 'JUL-243',
    currentState: 'Triage',
    admitted: true,
    issues: [],
  })
})

test('returns the launcher contract findings for an inadmissible card', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse('## Outcome\n\nOne outcome.'))

  assert.equal(result.admitted, false)
  assert.deepEqual(result.issues, [
    'missing nonempty Requirements section',
    'missing nonempty Contracts section',
    'missing nonempty Finish conditions section',
    'missing nonempty Proof section',
  ])
})

test('the command checks every requested card and exits nonzero when one fails', () => {
  const script = fileURLToPath(new URL('../src/mastra/card-admission-check.ts', import.meta.url))
  const fetchFixture = new URL('../support/card-admission-test-fixtures/card-admission-fetch.mjs', import.meta.url).href
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', fetchFixture, script, 'JUL-243', 'JUL-244',
  ], {
    encoding: 'utf8',
    env: { ...process.env, LINEAR_API_KEY: 'reference-only' },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stdout), [
    { identifier: 'JUL-243', currentState: 'Triage', admitted: true, issues: [] },
    {
      identifier: 'JUL-244',
      currentState: 'Triage',
      admitted: false,
      issues: [
        'missing nonempty Requirements section',
        'missing nonempty Contracts section',
        'missing nonempty Finish conditions section',
        'missing nonempty Proof section',
      ],
    },
  ])
})

test('the command refuses an empty card list', () => {
  const script = fileURLToPath(new URL('../src/mastra/card-admission-check.ts', import.meta.url))
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
    encoding: 'utf8',
    env: { ...process.env, LINEAR_API_KEY: 'reference-only' },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /usage: card-admission-check\.ts JUL-nnn/)
})
