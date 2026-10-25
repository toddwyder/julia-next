import test from 'node:test'
import assert from 'node:assert/strict'
import { notePausedBuild } from '../src/mastra/paused-note.ts'

function client(calls, issue = 'issue-uuid') {
  return {
    query: async (_document, variables) => {
      calls.push({ operation: 'query', variables })
      return Response.json({ data: issue ? { issue: { id: issue } } : { issue: null } })
    },
    mutate: async (_document, variables) => {
      calls.push({ operation: 'mutate', variables })
      return Response.json({ data: { commentCreate: { success: true } } })
    },
  }
}

const paused = {
  runId: 'jul-252-run',
  state: 'paused',
  error: { message: 'runaway: reached the 100-turn limit' },
  pause: { at: '2026-10-25T10:00:00.000Z' },
  snapshot: { card: { identifier: 'JUL-252' } },
}

test('a paused build posts one note with its pause reason', async () => {
  const calls = []
  const posted = new Set()
  assert.equal(await notePausedBuild({ job: paused, client: client(calls), posted }), true)
  assert.deepEqual(calls.map(call => call.operation), ['query', 'mutate'])
  assert.deepEqual(calls[1].variables, { input: { issueId: 'issue-uuid', body: 'runaway: reached the 100-turn limit' } })
  assert.equal(await notePausedBuild({ job: paused, client: client(calls), posted }), false)
  assert.equal(calls.length, 2)
})

test('a running, already-noted or unreadable paused build is not noted', async () => {
  const calls = []
  assert.equal(await notePausedBuild({ job: { ...paused, state: 'running' }, client: client(calls) }), false)
  assert.equal(await notePausedBuild({ job: { ...paused, linearNote: { posted: true } }, client: client(calls) }), false)
  assert.equal(await notePausedBuild({ job: paused, client: client(calls, '') }), false)
  assert.equal(calls.length, 1)
})
