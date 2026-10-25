import test from 'node:test'
import assert from 'node:assert/strict'
import { postLinearComment } from '../linear-note.mjs'

test('a pause note is posted to the card through Linear commentCreate', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body, authorization: init.headers.authorization })
    if (body.query.includes('query Issue')) return Response.json({ data: { issue: { id: 'issue-uuid' } } })
    return Response.json({ data: { commentCreate: { success: true } } })
  }
  const result = await postLinearComment({ card: 'JUL-252', message: 'paused with work kept', apiKey: 'synthetic', fetchImpl })
  assert.deepEqual(result, { posted: true })
  assert.deepEqual(calls.map(call => call.authorization), ['synthetic', 'synthetic'])
  assert.deepEqual(calls[0].body.variables, { id: 'JUL-252' })
  assert.deepEqual(calls[1].body.variables, { input: { issueId: 'issue-uuid', body: 'paused with work kept' } })
})

test('a missing key or a rejected Linear call reports why without throwing', async () => {
  assert.deepEqual(await postLinearComment({ card: 'JUL-252', message: 'paused', apiKey: '' }), {
    posted: false,
    reason: 'LINEAR_API_KEY is not present in the runner environment',
  })
  const rejected = await postLinearComment({
    card: 'JUL-252', message: 'paused', apiKey: 'synthetic',
    fetchImpl: async () => Response.json({ data: { issue: null } }),
  })
  assert.equal(rejected.posted, false)
  assert.match(rejected.reason, /found no issue/)
})
