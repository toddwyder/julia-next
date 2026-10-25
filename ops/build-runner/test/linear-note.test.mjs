import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLinearCard, moveLinearCard, postLinearComment } from '../linear-note.mjs'

const issueWithStates = (states) => ({
  data: { issue: { id: 'issue-uuid', team: { states: { nodes: states } } } },
})

test('the current card text and labels are read from Linear before each review', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization, redirect: init.redirect, body: JSON.parse(init.body) })
    return Response.json({
      data: {
        issue: {
          identifier: 'JUL-270',
          title: 'Practice card',
          description: '## Acceptance criteria\n\n* The edited wording.',
          state: { name: 'Evidence review' },
          labels: { nodes: [{ name: 'ready-for-agent' }, { name: 'Feature' }] },
        },
      },
    })
  }
  const card = await fetchLinearCard({ card: 'JUL-270', apiKey: 'synthetic', fetchImpl })
  assert.deepEqual(card, {
    identifier: 'JUL-270',
    title: 'Practice card',
    description: '## Acceptance criteria\n\n* The edited wording.',
    state: 'Evidence review',
    labels: ['ready-for-agent', 'Feature'],
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].authorization, 'synthetic')
  assert.equal(calls[0].redirect, 'error')
  assert.deepEqual(calls[0].body.variables, { id: 'JUL-270' })
  assert.match(calls[0].body.query, /description/)
  assert.match(calls[0].body.query, /labels/)
  assert.equal(await fetchLinearCard({ card: 'JUL-270', apiKey: '' }), null)
  const unavailable = await fetchLinearCard({ card: 'JUL-270', apiKey: 'synthetic', fetchImpl: async () => Response.json({ data: { issue: null } }) })
  assert.equal(unavailable, null)
  const unreachable = await fetchLinearCard({ card: 'JUL-270', apiKey: 'synthetic', fetchImpl: async () => { throw new Error('socket closed') } })
  assert.equal(unreachable, null)
})

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

test('the card moves to the team state whose name matches, whatever its case', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ body, authorization: init.headers.authorization, redirect: init.redirect })
    if (body.query.includes('query Issue')) {
      return Response.json(issueWithStates([
        { id: 'state-todo', name: 'Ready' },
        { id: 'state-remediation', name: 'Remediation' },
        { id: 'state-review', name: 'Evidence review' },
      ]))
    }
    return Response.json({ data: { issueUpdate: { success: true } } })
  }
  const result = await moveLinearCard({ card: 'JUL-252', stateName: 'remediation', apiKey: 'synthetic', fetchImpl })
  assert.deepEqual(result, { moved: true })
  assert.deepEqual(calls.map(call => call.authorization), ['synthetic', 'synthetic'])
  assert.deepEqual(calls[0].body.variables, { id: 'JUL-252' })
  assert.deepEqual(calls[1].body.variables, { id: 'JUL-252', stateId: 'state-remediation' })
  assert.match(calls[1].body.query, /issueUpdate\(id: \$id, input: \{ stateId: \$stateId \}\) \{ success \}/)
  assert.ok(calls.every(call => call.redirect === 'error'))
})

test('a state the team does not have leaves the card alone and says so', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    return Response.json(issueWithStates([{ id: 'state-todo', name: 'Ready' }]))
  }
  const result = await moveLinearCard({ card: 'JUL-252', stateName: 'Remediation', apiKey: 'synthetic', fetchImpl })
  assert.deepEqual(result, { moved: false, reason: 'Linear has no state named Remediation' })
  assert.equal(calls.length, 1)
})

test('a Linear rejection or a missing key never throws', async () => {
  assert.deepEqual(await moveLinearCard({ card: 'JUL-252', stateName: 'Remediation', apiKey: '' }), {
    moved: false,
    reason: 'LINEAR_API_KEY is not present in the runner environment',
  })
  const rejected = await moveLinearCard({
    card: 'JUL-252', stateName: 'Remediation', apiKey: 'synthetic',
    fetchImpl: async () => Response.json(issueWithStates([{ id: 'state-remediation', name: 'Remediation' }])),
  })
  assert.deepEqual(rejected, { moved: false, reason: 'Linear did not accept the state update' })
  const unreachable = await moveLinearCard({
    card: 'JUL-252', stateName: 'Remediation', apiKey: 'synthetic',
    fetchImpl: async () => { throw new Error('socket closed') },
  })
  assert.deepEqual(unreachable, { moved: false, reason: 'Linear state update failed: socket closed' })
})
