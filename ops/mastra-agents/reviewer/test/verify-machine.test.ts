import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { assertStableCandidateIdentity, candidateIdentity, doctor, fetchRehearsalCard, jul208Prompt } from '../src/mastra/verify-machine.ts'

const execute = promisify(execFile)

test('Doctor reads the permanent-parts inventory and fails closed on a missing controlled part', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-machine-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const existing = join(directory, 'present.exe')
  await writeFile(existing, '')
  const inventory = join(directory, 'permanent-parts.json')
  await writeFile(inventory, JSON.stringify({ version: 1, parts: [
    { id: 'present', name: 'Present', kind: 'executable', location: existing, permanent: true },
    { id: 'missing', name: 'Missing', kind: 'sign-in', location: join(directory, 'missing.json'), permanent: true },
  ] }))
  const frameworkMap = join(directory, 'framework-map.md')
  await writeFile(frameworkMap, `Doctor inventory: \`${inventory}\`.\n`)
  const result = await doctor(frameworkMap, async () => ({
    candidateCommit: 'a'.repeat(40),
    dirtyTreeDigest: `sha256:${'b'.repeat(64)}`,
  }))
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing.map(item => item.id), ['missing'])
  assert.equal(result.candidateCommit, 'a'.repeat(40))
  assert.equal(result.dirtyTreeDigest, `sha256:${'b'.repeat(64)}`)
})

test('candidate identity hashes tracked and untracked changes in a real Git repository', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-machine-git-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await execute('git', ['init', directory])
  const tracked = join(directory, 'tracked.txt')
  await writeFile(tracked, 'original\n')
  await execute('git', ['-C', directory, 'add', 'tracked.txt'])
  await execute('git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'user.name=Julia Test', '-c', 'user.email=julia@example.invalid', 'commit', '-m', 'initial'])

  const clean = await candidateIdentity(directory)
  assert.equal(clean.dirtyTreeDigest, 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')

  await writeFile(tracked, 'changed\n')
  const trackedChange = await candidateIdentity(directory)
  assert.notEqual(trackedChange.dirtyTreeDigest, clean.dirtyTreeDigest)

  await writeFile(tracked, 'original\n')
  await writeFile(join(directory, 'untracked.txt'), 'new evidence\n')
  const untrackedChange = await candidateIdentity(directory)
  assert.notEqual(untrackedChange.dirtyTreeDigest, clean.dirtyTreeDigest)
  assert.notEqual(untrackedChange.dirtyTreeDigest, trackedChange.dirtyTreeDigest)
})

test('rehearsal candidate identity stability rejects commit or dirty-tree drift', () => {
  const original = { candidateCommit: 'a'.repeat(40), dirtyTreeDigest: `sha256:${'b'.repeat(64)}` }
  assert.deepEqual(assertStableCandidateIdentity(original, { ...original }), original)
  assert.throws(() => assertStableCandidateIdentity(original, { ...original, candidateCommit: 'c'.repeat(40) }), /candidate identity changed during rehearsal/)
  assert.throws(() => assertStableCandidateIdentity(original, { ...original, dirtyTreeDigest: `sha256:${'d'.repeat(64)}` }), /candidate identity changed during rehearsal/)
})

test('F10 reads JUL-208 without admission and gives the reviewer the exact builder proposal', async () => {
  let request = ''
  const traces: unknown[] = []
  const card = await fetchRehearsalCard('linear-reference', async (_input, init) => {
    request = String(init?.body)
    return new Response(JSON.stringify({ data: { issue: {
      identifier: 'JUL-208', title: 'Keep a private recipe', description: 'Creation only; do not implement.', state: { name: 'Backlog' },
    } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, trace => { traces.push(trace) })
  const proposal = 'Change proposal with repository-specific file references.'
  const builderPrompt = jul208Prompt('builder', card, {})
  const reviewerPrompt = jul208Prompt('reviewer', card, { builder: proposal })
  assert.match(request, /"id":"JUL-208"/)
  assert.equal(card.state, 'Backlog')
  assert.deepEqual(traces.map(trace => (trace as { ok: boolean; issueId: string }).ok), [true])
  assert.equal((traces[0] as { issueId: string }).issueId, 'JUL-208')
  assert.match(builderPrompt, /concrete proposed change/)
  assert.match(builderPrompt, /do not implement/i)
  assert.ok(reviewerPrompt.includes(proposal))
  assert.match(reviewerPrompt, /substantive findings/i)
  assert.doesNotMatch(`${builderPrompt}\n${reviewerPrompt}`, /reply exactly/i)
})

test('F10 records a sanitized Linear trace when GraphQL fails with HTTP 200', async () => {
  const traces: Array<{ ok: boolean; status: number; errorCategory?: string }> = []
  await assert.rejects(() => fetchRehearsalCard('linear-reference', async () => new Response(JSON.stringify({ errors: [{ message: 'secret detail' }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }), trace => { traces.push(trace) }), /Linear JUL-208 read failed/)
  assert.deepEqual(traces.map(({ durationMs: _durationMs, ...trace }) => trace), [{ operation: 'linear-read', issueId: 'JUL-208', ok: false, status: 200, errorCategory: 'graphql' }])
  assert.equal(typeof traces[0]?.durationMs, 'number')
  assert.doesNotMatch(JSON.stringify(traces), /secret detail|linear-reference/)
})
